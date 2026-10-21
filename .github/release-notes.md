Free under the [MIT License](https://github.com/dimitriostzr/host-file-editor-crossplatform/blob/main/LICENSE). Unmaintained and provided as is, with no support.

## Download

| Platform             | File                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| macOS, Apple silicon | `hostserrer-*-mac-arm64.dmg`                                           |
| macOS, Intel         | `hostserrer-*-mac-x64.dmg`                                             |
| Windows, x64         | `hostserrer-*-win-x64.exe`                                             |
| Windows, ARM         | `hostserrer-*-win-arm64.exe`                                           |
| Linux, x64           | `hostserrer-*-linux-x86_64.AppImage` or `hostserrer-*-linux-amd64.deb` |
| Linux, ARM           | `hostserrer-*-linux-arm64.AppImage` or `hostserrer-*-linux-arm64.deb`  |

The `SHA256SUMS` files list a checksum for every file.

## The builds are not code-signed

There is no paid Apple or Microsoft signing certificate behind this project, so your system will
warn you the first time you open the app.

- **macOS:** open the app once, then go to System Settings → Privacy & Security and click
  **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/hostserrer.app`.
- **Windows:** in the SmartScreen dialog, click **More info** → **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`). Writing the hosts file uses `pkexec`,
  which needs polkit installed (most desktop distributions include it).

If you'd rather not trust a binary, build it from source. The README explains how.
