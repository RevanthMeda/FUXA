'use strict';

const fs = require('fs');
const path = require('path');
const {
    getNodeRedPaths,
    getNodeRedAuthCookieOptions,
    getPathWithoutBasePath,
    isNodeRedDashboardRequest,
    shouldBypassSpaCatchAll,
} = require('../../integrations/node-red');

describe('Node-RED SPA catch-all BASE_PATH handling', () => {
    let expect;

    before(async () => {
        const chai = await import('chai');
        expect = chai.expect;
    });

    it('strips the configured base path from application routes', () => {
        expect(getPathWithoutBasePath('/fuxa1/api/settings', '/fuxa1')).to.equal('/api/settings');
        expect(getPathWithoutBasePath('/fuxa1', '/fuxa1')).to.equal('/');
        expect(getPathWithoutBasePath('/api/settings', '/fuxa1')).to.equal('/api/settings');
    });

    it('bypasses API routes without a base path', () => {
        expect(shouldBypassSpaCatchAll('/api/settings', '')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/api', '')).to.equal(true);
    });

    it('bypasses API routes below BASE_PATH', () => {
        expect(shouldBypassSpaCatchAll('/fuxa1/api/settings', '/fuxa1')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/fuxa1/api', '/fuxa1')).to.equal(true);
    });

    it('still allows client-side SPA routes below BASE_PATH', () => {
        expect(shouldBypassSpaCatchAll('/fuxa1/editor', '/fuxa1')).to.equal(false);
        expect(shouldBypassSpaCatchAll('/fuxa1/view/overview', '/fuxa1')).to.equal(false);
    });

    it('continues bypassing static and Node-RED routes', () => {
        expect(shouldBypassSpaCatchAll('/fuxa1/assets/logo.svg', '/fuxa1')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/fuxa1/nodered', '/fuxa1')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/fuxa1/dashboard/ui', '/fuxa1')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/nodered', '/fuxa1')).to.equal(true);
        expect(shouldBypassSpaCatchAll('/dashboard/ui', '/fuxa1')).to.equal(true);
    });

    it('keeps Node-RED settings, mounts and cookies on the same base path', () => {
        expect(getNodeRedPaths('')).to.deep.equal({
            adminRoot: '/nodered/',
            adminMount: '/nodered',
            nodeRoot: '/dashboard',
        });
        expect(getNodeRedPaths('/fuxa1/')).to.deep.equal({
            adminRoot: '/fuxa1/nodered/',
            adminMount: '/fuxa1/nodered',
            nodeRoot: '/fuxa1/dashboard',
        });
        expect(getNodeRedAuthCookieOptions('/fuxa1')).to.deep.equal({
            path: '/fuxa1/nodered',
            sameSite: 'lax',
        });
    });

    it('recognizes dashboard requests with and without BASE_PATH', () => {
        expect(isNodeRedDashboardRequest({ baseUrl: '/dashboard' }, '')).to.equal(true);
        expect(isNodeRedDashboardRequest({ baseUrl: '/fuxa1/dashboard' }, '/fuxa1')).to.equal(true);
        expect(isNodeRedDashboardRequest({ baseUrl: '/fuxa1/nodered' }, '/fuxa1')).to.equal(false);
    });

    it('uses editor-relative custom-node APIs so BASE_PATH is preserved', () => {
        const nodesDir = path.join(__dirname, '../../integrations/node-red/node-red-contrib-fuxa/nodes');
        const apiCalls = fs.readdirSync(nodesDir)
            .filter(file => file.endsWith('.html'))
            .flatMap(file => fs.readFileSync(path.join(nodesDir, file), 'utf8')
                .match(/\$\.getJSON\('([^']+)'/g) || []);

        expect(apiCalls).to.have.length.greaterThan(0);
        expect(apiCalls.every(call => call.startsWith("$.getJSON('fuxa/"))).to.equal(true);
    });
});
