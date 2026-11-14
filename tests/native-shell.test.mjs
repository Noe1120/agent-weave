import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
test("native shell uses WPF with accessible project, conversation and task controls", () => {
  assert.ok(
    existsSync("packages/desktop/Team.csproj"),
    "native WPF project exists",
  );
  const project = readFileSync("packages/desktop/Team.csproj", "utf8");
  assert.match(project, /<UseWPF>true<\/UseWPF>/);
  assert.doesNotMatch(project, /WebView|Electron|CefSharp/i);
  const xaml = readFileSync("packages/desktop/MainWindow.xaml", "utf8");
  for (const id of [
    "ProjectList",
    "MessageInput",
    "Recipient",
    "SaveMessage",
    "TaskList",
    "NewProject",
    "Members",
    "Reconnect",
  ])
    assert.ok(
      xaml.includes('AutomationProperties.AutomationId="' + id + '"'),
      id + " accessible identifier",
    );
  assert.doesNotMatch(xaml, /WebBrowser|WebView|Frame\s+Source/);
});
