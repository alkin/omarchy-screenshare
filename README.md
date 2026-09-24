# Screen Share Indicator

A chip next to the clock in the Omarchy bar while Chrome is sharing your **screen**, a **window** or a **tab**. Hover it to see which site is sharing. Click it to jump to that tab.

![preview](preview.png)

- **Screen and window shares** work out of the box. The widget watches PipeWire for the portal's screencast stream flowing into Chrome.
- **Tab shares** never leave the browser, so no desktop API can see them. An optional companion extension (below) reports them. It also names the exact kind of share and the site, and it makes detection instant.

## Install

```sh
omarchy plugin add https://github.com/alkin/omarchy-screenshare.git --enable
omarchy bar move io.github.alkin.screenshare --after omarchy.clock
```

The second command puts the chip right after the clock. Without it, Omarchy places new center widgets after the weather.

### Optional: tab detection (Chrome/Chromium extension)

```sh
~/.config/omarchy/plugins/io.github.alkin.screenshare/install-chrome-extension
```

This registers a small native messaging host for Google Chrome and Chromium.

- **Chromium** loads the extension through `~/.config/chromium-flags.conf`. A backup is kept as `.bak`.
- **Google Chrome** has ignored `--load-extension` since version 137, so load the extension by hand once:
  1. Open `chrome://extensions` and turn on **Developer mode**.
  2. Click **Load unpacked** and pick `~/.config/omarchy/plugins/io.github.alkin.screenshare/chrome-extension`.

Restart the browser, or reload the tabs you want tracked. Once the extension is connected, the widget uses it instead of PipeWire.

## Usage

| Chip | Meaning |
| --- | --- |
| `󰹑 Screen` | an entire screen is being shared |
| `󰖯 Window` | a window is being shared |
| `󰓩 Tab` | a Chrome tab is being shared (extension only) |
| `󰹑 Sharing` | a screen or window is being shared (detected without the extension) |
| `… +1` | more than one share is running |

- **Hover** to list every share and the site running it.
- **Click** to focus the sharing tab (with the extension) or the Chrome window (without it).

## Configure

These settings go in the widget's entry in `~/.config/omarchy/shell.json`:

| Key | Default | Description |
| --- | --- | --- |
| `showLabel` | `true` | Show Screen / Window / Tab next to the icon |
| `pipewireFallback` | `true` | Detect screen and window shares when the extension is not installed |
| `previewDelayMs` | `1000` | PipeWire mode only: ignore streams shorter than this, so Chrome's picker preview doesn't flash the chip |

```json
{ "id": "io.github.alkin.screenshare", "showLabel": false }
```

## How it works

- **PipeWire.** The widget reads the PipeWire graph through Quickshell. It counts a share when a screencast source from the desktop portal (`xdg-desktop-portal-hyprland`, or another portal) is linked to a Chrome node. Cameras are ignored.
- **Extension.** A content script wraps `getDisplayMedia` in every page. It reads the chosen `displaySurface` (`monitor`, `window` or `browser`) and follows the track until it ends or is stopped.
- **Native host.** The service worker forwards the list of shares to `native-host/screenshare-host`, a python3 script that uses only the standard library. The host writes it to `$XDG_RUNTIME_DIR/omarchy-screenshare/chrome-<pid>.json`, and the widget watches that folder. The host deletes its files when Chrome closes.
- **Focus on click.** Clicks are sent back through a FIFO in the same folder.

### Privacy and permissions

- The extension never reads or sends captured media. It only reports that a capture exists, its kind, the tab's host name and the tab's title.
- The data stays on your machine, in a user-only runtime folder that is cleared at logout.
- The extension asks for `tabs`, to read the title and host and to focus the tab, and `nativeMessaging`. Its content script runs on all sites, because any site can start a screen share.

## Remove

```sh
~/.config/omarchy/plugins/io.github.alkin.screenshare/install-chrome-extension --uninstall   # if you installed it
omarchy plugin remove io.github.alkin.screenshare
```

In Google Chrome, also remove **Omarchy Screen Share Indicator** from `chrome://extensions`.

## Development

```sh
git clone https://github.com/alkin/omarchy-screenshare.git && cd omarchy-screenshare
scripts/dev-sync                         # copy into ~/.config/omarchy/plugins (symlinks are not allowed)
omarchy plugin validate ~/.config/omarchy/plugins/io.github.alkin.screenshare
omarchy-shell io.github.alkin.screenshare debug | jq   # live detection state
```

## License

MIT
