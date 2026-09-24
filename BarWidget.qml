import QtQuick
import Qt.labs.folderlistmodel
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire
import qs.Commons
import qs.Ui
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "io.github.alkin.screenshare"

  readonly property bool showLabel: setting("showLabel", true) === true
  readonly property bool pipewireFallback: setting("pipewireFallback", true) === true
  readonly property int previewDelayMs: Number(setting("previewDelayMs", 1000))

  readonly property string stateDir: Quickshell.env("XDG_RUNTIME_DIR") + "/omarchy-screenshare"
  readonly property string pluginDir: String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")

  // --- Extension: one JSON file per native host (one host per Chrome profile).
  property var extensionFiles: ({})
  readonly property var extensionStates: {
    var list = []
    for (var path in extensionFiles) list.push(extensionFiles[path])
    return list
  }
  readonly property bool extensionConnected: extensionStates.length > 0

  // --- PipeWire: portal video streams flowing into Chrome (screen/window only).
  readonly property int pipewireLiveCount: {
    var groups = Pipewire.linkGroups ? Pipewire.linkGroups.values : []
    var count = 0
    for (var i = 0; i < groups.length; i++) {
      if (Model.isChromeShareLink(groups[i], PwNodeType.Video)) count++
    }
    return count
  }
  // Chrome's picker opens a short-lived preview stream before "Share" is
  // pressed; only count streams that outlive it.
  property int pipewireCount: 0

  readonly property var sessions: extensionConnected
    ? Model.extensionSessions(extensionStates)
    : (pipewireFallback ? Model.pipewireSessions(pipewireCount) : [])
  readonly property bool sharing: sessions.length > 0

  visible: sharing
  implicitWidth: root.vertical ? root.barSize : chip.width + Style.space(8)
  implicitHeight: root.vertical ? chip.height + Style.space(8) : root.barSize

  onPipewireLiveCountChanged: {
    if (pipewireLiveCount > pipewireCount) {
      previewTimer.restart()
    } else {
      previewTimer.stop()
      pipewireCount = pipewireLiveCount
    }
  }

  function setExtensionFile(path, text) {
    var files = Object.assign({}, extensionFiles)
    var state = null
    try {
      state = text ? JSON.parse(text) : null
    } catch (error) {
      state = null
    }
    if (state) files[path] = state
    else delete files[path]
    extensionFiles = files
  }

  function dropExtensionFile(path) {
    if (!(path in extensionFiles)) return
    var files = Object.assign({}, extensionFiles)
    delete files[path]
    extensionFiles = files
  }

  function focusShare() {
    var session = sessions.length > 0 ? sessions[0] : null
    var command = [pluginDir + "/bin/screenshare-focus"]
    if (session && session.source === "extension") command.push(String(session.host), String(session.tabId))
    focusProc.command = command
    focusProc.running = true
  }

  Timer {
    id: previewTimer
    interval: root.previewDelayMs
    onTriggered: root.pipewireCount = root.pipewireLiveCount
  }

  // Bind the nodes on both ends of every link so their names and types
  // are populated for the filter above.
  PwObjectTracker {
    objects: {
      var groups = Pipewire.linkGroups ? Pipewire.linkGroups.values : []
      var nodes = []
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].source) nodes.push(groups[i].source)
        if (groups[i].target) nodes.push(groups[i].target)
      }
      return nodes
    }
  }

  // The folder has to exist before FolderListModel can watch it.
  Process {
    running: true
    command: ["mkdir", "-p", root.stateDir]
    onExited: stateFolder.folder = "file://" + root.stateDir
  }

  FolderListModel {
    id: stateFolder
    nameFilters: ["chrome-*.json"]
    showDirs: false
    showHidden: false
  }

  Instantiator {
    model: stateFolder

    delegate: FileView {
      required property string filePath

      path: filePath
      watchChanges: true
      printErrors: false
      onLoaded: root.setExtensionFile(filePath, text())
      onFileChanged: reload()
      onLoadFailed: root.dropExtensionFile(filePath)
    }

    onObjectRemoved: function(index, object) { root.dropExtensionFile(object.path) }
  }

  Process { id: focusProc }

  IpcHandler {
    target: "io.github.alkin.screenshare"

    function debug(): string {
      var groups = Pipewire.linkGroups ? Pipewire.linkGroups.values : []
      var links = []
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i]
        links.push({
          source: g.source ? { name: g.source.name, type: g.source.type, isStream: g.source.isStream } : null,
          target: g.target ? { name: g.target.name, type: g.target.type, isStream: g.target.isStream } : null,
          state: g.state,
          match: Model.isChromeShareLink(g, PwNodeType.Video)
        })
      }
      return JSON.stringify({
        pipewireLiveCount: root.pipewireLiveCount,
        pipewireCount: root.pipewireCount,
        extensionStates: root.extensionStates,
        sessions: root.sessions,
        links: links
      })
    }
  }

  Rectangle {
    id: chip

    anchors.centerIn: parent
    height: Math.round(root.vertical ? content.implicitWidth + Style.space(8) : root.barSize * 0.68)
    width: root.vertical ? Math.round(root.barSize * 0.68) : content.implicitWidth + Style.space(16)
    radius: Math.min(width, height) / 2
    color: root.bar ? root.bar.urgent : Color.urgent

    Row {
      id: content

      anchors.centerIn: parent
      spacing: Style.space(5)

      Text {
        text: Model.icon(root.sessions)
        color: root.bar ? root.bar.background : Color.background
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        visible: root.showLabel && !root.vertical
        text: Model.label(root.sessions)
        color: root.bar ? root.bar.background : Color.background
        font.family: root.bar ? root.bar.fontFamily : Style.font.family
        font.pixelSize: Style.font.caption
        font.bold: true
        renderType: Text.NativeRendering
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: if (root.bar) root.bar.showTooltip(root, Model.tooltip(root.sessions))
    onExited: if (root.bar) root.bar.hideTooltip(root)
    onClicked: {
      if (root.bar) root.bar.hideTooltip(root)
      root.focusShare()
    }
  }
}
