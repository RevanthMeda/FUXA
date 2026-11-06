const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '../src/app/device/device-list/device-list.component.ts'),
    'utf8'
);

function method(name) {
    const signature = new RegExp(`(?:private\\s+)?${name}\\([^)]*\\)(?::\\s*[^\\{]+)?\\s*\\{`, 'm');
    const match = signature.exec(source);
    assert.ok(match, `${name} method exists`);
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let index = bodyStart;
    while (depth > 0 && index < source.length) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        index++;
    }
    assert.equal(depth, 0, `${name} method is balanced`);
    return new Function(...methodArgs(name), source.slice(bodyStart, index - 1));
}

function optionalMethod(name) {
    try {
        return method(name);
    } catch {
        return null;
    }
}

function methodArgs(name) {
    if (name === 'bindToTable') return ['tags'];
    if (name === 'applyFilter') return ['filterValue'];
    return [];
}

function createComponent(tagCount = 80) {
    const subscriptions = [];
    const tags = {};
    for (let index = 0; index < tagCount; index++) {
        const id = `tag-${String(index).padStart(3, '0')}`;
        tags[id] = { id, name: `Tag ${index}` };
    }
    const dataSource = {
        _data: [],
        filteredData: [],
        _filter: '',
        sortData(values) { return values; }
    };
    Object.defineProperties(dataSource, {
        data: {
            get() { return this._data; },
            set(values) {
                this._data = values;
                this.filteredData = this._filter
                    ? values.filter(value => JSON.stringify(value).toLowerCase().includes(this._filter))
                    : values.slice();
            }
        },
        filter: {
            get() { return this._filter; },
            set(value) {
                this._filter = value;
                this.filteredData = this._data.filter(row => JSON.stringify(row).toLowerCase().includes(value));
            }
        }
    });
    const component = {
        dataSource,
        paginator: {
            pageIndex: 0,
            pageSize: 25,
            firstPage() { this.pageIndex = 0; }
        },
        sort: { active: '', direction: '' },
        hmiService: {
            viewsTagsSubscribe(ids, sendLastValue) {
                subscriptions.push({ ids: Array.from(ids), sendLastValue });
            }
        }
    };
    component.bindToTable = method('bindToTable');
    component.onVisibleTagsChanged = optionalMethod('onVisibleTagsChanged');
    component.applyFilter = method('applyFilter');
    return { component, subscriptions, tags };
}

test('device tag table subscribes only to the visible first page', () => {
    const { component, subscriptions, tags } = createComponent();

    component.bindToTable(tags);

    assert.deepEqual(subscriptions.at(-1), {
        ids: Object.keys(tags).slice(0, 25),
        sendLastValue: true
    });
});

test('changing pages replaces the live-value subscription with that page', () => {
    const { component, subscriptions, tags } = createComponent();
    component.bindToTable(tags);

    component.paginator.pageIndex = 1;
    assert.equal(typeof component.onVisibleTagsChanged, 'function');
    component.onVisibleTagsChanged();

    assert.deepEqual(subscriptions.at(-1), {
        ids: Object.keys(tags).slice(25, 50),
        sendLastValue: true
    });
});

test('filtering resets pagination and subscribes only to matching visible tags', () => {
    const { component, subscriptions, tags } = createComponent();
    component.bindToTable(tags);
    component.paginator.pageIndex = 2;

    component.applyFilter('Tag 7');

    assert.equal(component.paginator.pageIndex, 0);
    assert.deepEqual(subscriptions.at(-1), {
        ids: ['tag-007', 'tag-070', 'tag-071', 'tag-072', 'tag-073', 'tag-074', 'tag-075', 'tag-076', 'tag-077', 'tag-078', 'tag-079'],
        sendLastValue: true
    });
});

test('sorting subscribes to the rows rendered on the sorted page', () => {
    const { component, subscriptions, tags } = createComponent(30);
    component.bindToTable(tags);
    component.sort = { active: 'name', direction: 'desc' };
    component.dataSource.sortData = values => values.slice().reverse();

    component.onVisibleTagsChanged();

    assert.deepEqual(subscriptions.at(-1), {
        ids: Object.keys(tags).reverse().slice(0, 25),
        sendLastValue: true
    });
});

test('table page and sort events refresh visible subscriptions', () => {
    const template = fs.readFileSync(
        path.join(__dirname, '../src/app/device/device-list/device-list.component.html'),
        'utf8'
    );

    assert.match(template, /\(matSortChange\)="onVisibleTagsChanged\(\)"/);
    assert.match(template, /\(page\)="onVisibleTagsChanged\(\)"/);
});
