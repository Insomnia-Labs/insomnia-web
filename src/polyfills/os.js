/**
 * Browser stub for Node.js `os` module.
 * GramJS calls os.type(), os.hostname(), os.platform(), os.homedir() etc.
 * The vite-plugin-node-polyfills version doesn't implement all of these,
 * so we provide a complete stub that satisfies GramJS.
 */

export function type() { return 'Browser' }
export function platform() { return 'browser' }
export function hostname() { return 'localhost' }
export function homedir() { return '/' }
export function tmpdir() { return '/tmp' }
export function arch() { return 'x64' }
export function release() { return '1.0.0' }
export function version() { return '' }
export function cpus() { return [] }
export function freemem() { return 0 }
export function totalmem() { return 0 }
export function uptime() { return 0 }
export function userInfo() { return { username: 'user', uid: -1, gid: -1, shell: null, homedir: '/' } }
export const EOL = '\n'
export const constants = {}

export default {
    type, platform, hostname, homedir, tmpdir,
    arch, release, version, cpus, freemem,
    totalmem, uptime, userInfo, EOL, constants,
}
