const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const rxjs = require('rxjs');

const filename = path.join(__dirname, '../src/app/header/header.component.ts');
const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
    reportDiagnostics: true
});
assert.equal(diagnostics.length, 0);

const decorator = () => () => {};
const exportsObject = {};
const imports = {
    '@angular/core': { Component: decorator, Inject: decorator, ViewChild: decorator },
    '@angular/router': { NavigationEnd: class NavigationEnd {} },
    'rxjs': rxjs,
    '@angular/material/dialog': { MAT_DIALOG_DATA: {}, MatDialog: class {}, MatDialogRef: class {} },
    '../../environments/environment': { environment: {} },
    '../editor/setup/setup.component': { SetupComponent: class {} },
    '../_services/project.service': { SaveMode: { Current: 0, SaveAs: 1, Save: 2 } },
    '../_services/theme.service': { ThemeService: { ThemeType: { Default: 'default', Dark: 'dark' } } },
    '../_models/hmi': { HelpData: class {}, DEVICE_READONLY: 'readonly' },
    '../help/tutorial/tutorial.component': { TutorialComponent: class {} },
    '@ngx-translate/core': { TranslateService: class {} },
    '../gui-helpers/edit-name/edit-name.component': { EditNameComponent: class {} }
};

class FileReader {
    readAsText() {
        this.result = JSON.stringify({ name: 'Imported project', data: {} });
        this.onload();
    }
}

vm.runInNewContext(outputText, {
    exports: exportsObject,
    FileReader,
    require: name => imports[name] || {},
    window: { confirm: () => true },
    document: { getElementById: () => ({ click() {} }) },
    console
}, { filename });

test('backs up the current project before replacing it with an imported project', () => {
    const { HeaderComponent } = exportsObject;
    const operations = [];
    const router = {
        events: { pipe: () => ({ subscribe() {} }) },
        url: '/editor'
    };
    const projectService = {
        getLayoutTheme: () => 'default',
        saveAs: () => operations.push('backup'),
        setProject: project => operations.push(['import', project.name])
    };
    const header = new HeaderComponent(router, {}, {}, { setTheme() {} }, projectService);
    header.fileImportInput = { nativeElement: { value: 'selected-project.json' } };

    header.onFileChangeListener({ target: { files: [{ name: 'selected-project.json' }] } });

    assert.deepEqual(operations, ['backup', ['import', 'Imported project']]);
    assert.equal(header.fileImportInput.nativeElement.value, null);
});
