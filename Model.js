.pragma library

// Pure helpers for the screen-share chip. Kept free of QML types so the
// merge/label rules can be read (and reasoned about) in one place.

var surfaceOrder = { monitor: 0, window: 1, browser: 2, unknown: 3 }

var surfaceLabels = {
  monitor: "Screen",
  window: "Window",
  browser: "Tab",
  unknown: "Sharing"
}

var surfaceIcons = {
  monitor: 0xF0E51,  // nf-md-monitor_share
  window: 0xF05AF,   // nf-md-window_maximize
  browser: 0xF04E9,  // nf-md-tab
  unknown: 0xF0E51
}

function normalizeSurface(value) {
  var surface = String(value || "")
  return surfaceOrder[surface] !== undefined ? surface : "unknown"
}

// Screencast nodes published by desktop portals (Hyprland, wlroots, GNOME,
// KDE). Cameras are Video/Source nodes too, so they must not match.
function isScreencastName(name) {
  return /xdg-desktop-portal|xdph|xdpw|screencast|screen-cast/i.test(String(name || ""))
}

function isChromeName(name) {
  return /chrom/i.test(String(name || ""))
}

// A PipeWire link group counts as a Chrome share when a video source (the
// portal's screencast node) feeds a Chrome node. Quickshell leaves video
// input streams unclassified (type 0, isStream false) and the group's state
// reads as an error until bound, so only the source type and the target name
// are trusted; the group disappears as soon as the stream stops.
function isChromeShareLink(group, videoFlag) {
  if (!group || !group.source || !group.target) return false

  var source = group.source
  var target = group.target
  if (source.isStream) return false
  if ((source.type & videoFlag) === 0) return false
  if (!isScreencastName(source.name)) return false
  return isChromeName(target.name)
}

// Flatten every extension state file into one list of sessions.
function extensionSessions(states) {
  var list = []
  for (var i = 0; i < states.length; i++) {
    var state = states[i]
    if (!state || !state.sessions || typeof state.sessions.length !== "number") continue
    for (var j = 0; j < state.sessions.length; j++) {
      var session = state.sessions[j]
      if (!session) continue
      list.push({
        source: "extension",
        host: state.pid || 0,
        tabId: session.tabId,
        windowId: session.windowId,
        origin: String(session.origin || ""),
        title: String(session.title || ""),
        surface: normalizeSurface(session.surface),
        since: Number(session.since || 0)
      })
    }
  }
  list.sort(function(a, b) {
    return surfaceOrder[a.surface] - surfaceOrder[b.surface] || a.since - b.since
  })
  return list
}

function pipewireSessions(count) {
  var list = []
  for (var i = 0; i < count; i++) list.push({ source: "pipewire", surface: "unknown", origin: "", title: "" })
  return list
}

// The first session drives the chip; sessions are sorted so that the most
// revealing kind of share (the whole screen) wins.
function primarySurface(sessions) {
  return sessions.length > 0 ? sessions[0].surface : "unknown"
}

function icon(sessions) {
  return String.fromCodePoint(surfaceIcons[primarySurface(sessions)])
}

function label(sessions) {
  if (sessions.length === 0) return ""
  var text = surfaceLabels[primarySurface(sessions)]
  return sessions.length > 1 ? text + " +" + (sessions.length - 1) : text
}

function describe(session) {
  var kind = session.surface === "unknown" ? "screen or window" : surfaceLabels[session.surface].toLowerCase()
  var line = "Sharing " + kind
  if (session.origin) line += " · " + session.origin
  return line
}

function tooltip(sessions) {
  var lines = []
  for (var i = 0; i < sessions.length; i++) lines.push(describe(sessions[i]))
  if (sessions.length > 0) lines.push("Click to focus")
  return lines.join("\n")
}
