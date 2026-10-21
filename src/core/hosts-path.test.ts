import { describe, it, expect } from 'vitest'
import { defaultHostsPath, resolveHostsPath, HOSTS_PATH_ENV } from './hosts-path.js'

describe('defaultHostsPath', () => {
  it('darwin', () => expect(defaultHostsPath('darwin', {})).toBe('/etc/hosts'))
  it('linux', () => expect(defaultHostsPath('linux', {})).toBe('/etc/hosts'))
  it('win32 honours SystemRoot', () =>
    expect(defaultHostsPath('win32', { SystemRoot: 'D:\\Windows' })).toBe(
      'D:\\Windows\\System32\\drivers\\etc\\hosts',
    ))
  it('win32 falls back to windir', () =>
    expect(defaultHostsPath('win32', { windir: 'E:\\Win' })).toBe(
      'E:\\Win\\System32\\drivers\\etc\\hosts',
    ))
  it('win32 falls back to C:\\Windows', () =>
    expect(defaultHostsPath('win32', {})).toBe('C:\\Windows\\System32\\drivers\\etc\\hosts'))
})

describe('resolveHostsPath', () => {
  it('uses the platform default and reports not sandboxed', () =>
    expect(resolveHostsPath({}, 'linux')).toEqual({ path: '/etc/hosts', sandboxed: false }))
  it('an override wins and is flagged as sandboxed', () =>
    expect(resolveHostsPath({ [HOSTS_PATH_ENV]: '/tmp/sandbox-hosts' }, 'linux')).toEqual({
      path: '/tmp/sandbox-hosts',
      sandboxed: true,
    }))
  it('trims the override', () =>
    expect(resolveHostsPath({ [HOSTS_PATH_ENV]: '  /tmp/x  ' }, 'linux').path).toBe('/tmp/x'))
  it('ignores a blank override rather than resolving to an empty path', () =>
    expect(resolveHostsPath({ [HOSTS_PATH_ENV]: '   ' }, 'linux')).toEqual({
      path: '/etc/hosts',
      sandboxed: false,
    }))
  it('an override applies on windows too', () =>
    expect(resolveHostsPath({ [HOSTS_PATH_ENV]: 'C:\\tmp\\h' }, 'win32').sandboxed).toBe(true))
})
