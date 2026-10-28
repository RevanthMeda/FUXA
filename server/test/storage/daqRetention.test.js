const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('sqlite3');
const storage = require('../../runtime/storage/sqlite');

const execute = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
const cutoff = new Date(2026, 0, 2, 12);

describe('DAQ archive retention boundary', function () {
    const cases = [
        ['deletes an archive wholly before the cutoff', '20260101000000', '20260102115959', true],
        ['preserves an archive spanning the cutoff', '20260101000000', '20260103120000', false],
        ['preserves an archive ending exactly at the cutoff', '20260101000000', '20260102120000', false],
        ['preserves an archive starting exactly at the cutoff', '20260102120000', '20260103120000', false],
        ['preserves an archive wholly after the cutoff', '20260103000000', '20260104120000', false],
    ];
    for (const [title, from, to, expired] of cases) {
        it(title, async function () {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-retention-'));
            const archive = path.join(directory, 'archive');
            fs.mkdirSync(archive);
            const filename = 'daq-data_line_a_' + from + '_' + to + '.db';
            const file = path.join(archive, filename);
            const db = new sqlite.Database(file);
            const end = new Date(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8), +to.slice(8, 10), +to.slice(10, 12), +to.slice(12, 14));
            try {
                await execute(db, 'CREATE TABLE data (dt INTEGER, id INTEGER, value TEXT); INSERT INTO data VALUES (' + end.getTime() + ", 1, 'sample');");
            } finally { await close(db); }
            const original = fs.readFileSync(file);
            const unlink = fs.unlink;
            const writes = [];
            const removed = [];
            const errors = [];
            // Observe completion while forwarding every deletion to the real filesystem.
            fs.unlink = function (target, callback) {
                const completed = new Promise(resolve => {
                    unlink.call(fs, target, error => {
                        try { callback(error); } finally { resolve(); }
                    });
                });
                writes.push(completed);
            };
            try {
                storage.checkRetention(cutoff, directory, name => removed.push(name), error => errors.push(error));
                await Promise.all(writes);
                assert.deepEqual(errors, []);
                assert.deepEqual(removed, expired ? [filename] : []);
                assert.equal(fs.existsSync(file), !expired);
                if (!expired) assert.deepEqual(fs.readFileSync(file), original);
            } finally {
                fs.unlink = unlink;
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });
    }
});
