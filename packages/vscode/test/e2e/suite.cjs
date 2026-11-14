// Runs inside a real VS Code window with the extension loaded in development mode.
// Started by run.mjs; writes what it saw to EMAKI_E2E_REPORT.
const vscode = require('vscode');
const fs = require('fs');

const out = [];
const log = (...a) => {
  out.push(a.join(' '));
  // Also written as we go, so a hang still shows how far the run got.
  if (process.env.EMAKI_E2E_REPORT) fs.appendFileSync(process.env.EMAKI_E2E_REPORT + '.partial', a.join(' ') + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(100);
  }
}

exports.run = async function run() {
  const report = process.env.EMAKI_E2E_REPORT;
  try {
    const story = process.env.EMAKI_E2E_STORY;
    const doc = await vscode.workspace.openTextDocument(story);
    const editor = await vscode.window.showTextDocument(doc);
    log('languageId:', doc.languageId);
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'emaki-vscode');
    await ext.activate();
    log('extension active:', ext.isActive);

    const original = doc.getText();
    const lines = original.split('\n');
    /** Put the file back exactly as it was (the undo command depends on focus, so it's unreliable here). */
    const restore = async () => {
      await editor.edit((e) => e.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original));
      await doc.save();
    };
    const pos = (needle, offset = 1) => {
      const l = lines.findIndex((x) => x.includes(needle));
      return new vscode.Position(l, lines[l].indexOf(needle) + offset);
    };

    await sleep(500);
    log('diagnostics on demo:', vscode.languages.getDiagnostics(doc.uri).length);

    // Break a jump and watch the error appear.
    const jumpPos = pos('jump kitchen_talk', 0);
    await editor.edit((e) => e.replace(new vscode.Range(jumpPos.line, jumpPos.character + 5, jumpPos.line, jumpPos.character + 17), 'kitchen_tlak'));
    const diags = await waitFor(() => { const d = vscode.languages.getDiagnostics(doc.uri); return d.length ? d : null; });
    const d = diags?.[0];
    log('after typo:', d ? `line ${d.range.start.line + 1} cols ${d.range.start.character}-${d.range.end.character} "${d.message}"` : 'NO DIAGNOSTIC');
    await restore();
    await waitFor(() => vscode.languages.getDiagnostics(doc.uri).length === 0);
    log('after fixing it:', vscode.languages.getDiagnostics(doc.uri).length, 'diagnostics');

    const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos('jump kitchen_talk', 6));
    log('definition of kitchen_talk: line', defs?.[0] && (defs[0].range ?? defs[0].targetRange).start.line + 1);

    const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', doc.uri, pos('trust +='));
    log('references to trust:', refs?.length);

    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos('mira:'));
    log('hover on mira:', hovers?.[0]?.contents?.map((c) => c.value ?? c).join(' '));

    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
    log('outline labels:', symbols?.filter((s) => s.kind === vscode.SymbolKind.Function).map((s) => s.name).join(', '));

    // Completion after "jump " on a fresh line.
    const endOfLabel = pos('jump kitchen_talk', 0);
    await editor.edit((e) => e.insert(new vscode.Position(endOfLabel.line + 1, 0), '  jump \n'));
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(endOfLabel.line + 1, 7));
    const names = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    log('completions after "jump ":', names.filter((n) => /^[a-z_]+$/.test(n)).slice(0, 8).join(', '));
    await restore();

    // Plugins: checked and completed against the game's plugins/*/plugin.json, re-read when it changes.
    const after = pos('jump kitchen_talk', 0);
    await editor.edit((e) => e.insert(new vscode.Position(after.line + 1, 0), '  set trust = @dice.roll()  # roll for it\n'));
    const pd = await waitFor(() => { const d = vscode.languages.getDiagnostics(doc.uri); return d.length ? d : null; });
    log('plugin function without its argument:', pd?.[0]?.code?.value ?? pd?.[0]?.code, '-', pd?.[0]?.message);
    const fl = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(after.line + 1, 20));
    log('completions after "@dice.":', fl.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label)).filter((n) => n === 'roll').join(', '));
    fs.writeFileSync(process.env.EMAKI_E2E_PLUGIN, JSON.stringify({ functions: { roll: { args: { sides: 'number?' }, returns: 'number' } } }));
    await waitFor(() => vscode.languages.getDiagnostics(doc.uri).length === 0);
    log('after making the argument optional in plugin.json:', vscode.languages.getDiagnostics(doc.uri).length, 'diagnostics');
    const manifest = vscode.Uri.file(process.env.EMAKI_E2E_PLUGIN);
    fs.writeFileSync(process.env.EMAKI_E2E_PLUGIN, '{ "functions": ');
    const md = await waitFor(() => { const d = vscode.languages.getDiagnostics(manifest); return d.length ? d : null; });
    log('a broken plugin.json:', md?.[0]?.message ?? 'NO DIAGNOSTIC');
    fs.writeFileSync(process.env.EMAKI_E2E_PLUGIN, JSON.stringify({ functions: { roll: { args: { sides: 'number?' } } } }));
    await waitFor(() => vscode.languages.getDiagnostics(manifest).length === 0);
    log('fixed again:', vscode.languages.getDiagnostics(manifest).length, 'diagnostics on plugin.json');
    await restore();

    // Format a messy file.
    const messy = await vscode.workspace.openTextDocument({ language: 'emaki', content: 'label a:\n      "x"\n      jump a\n' });
    const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', messy.uri, { tabSize: 2, insertSpaces: true });
    const we = new vscode.WorkspaceEdit();
    for (const e of edits) we.replace(messy.uri, e.range, e.newText);
    await vscode.workspace.applyEdit(we);
    log('formatted (' + edits.length + ' edits):', JSON.stringify(messy.getText()));
    const broken = await vscode.workspace.openTextDocument({ language: 'emaki', content: 'label a:\n  jump\n' });
    const none = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', broken.uri, { tabSize: 2, insertSpaces: true });
    log('format on broken file:', none?.length ?? 0, 'edits');

    // Comment toggling uses the language configuration.
    const active = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    active.selection = new vscode.Selection(pos('mira:', 0), pos('mira:', 0));
    // Editor commands act on the focused editor, which a freshly opened test window may not have yet.
    for (let attempt = 0; attempt < 5 && doc.getText() === original; attempt++) {
      await waitFor(() => vscode.window.activeTextEditor?.document === doc, 2000);
      await vscode.commands.executeCommand('editor.action.commentLine');
      await sleep(200);
    }
    log('toggle comment:', doc.getText() === original
      ? 'not checked (the test window never got keyboard focus)'
      : JSON.stringify(doc.lineAt(pos('mira:', 0).line).text.slice(0, 20)));
    await restore();

    // Preview from this line opens the game beside the script (needs `npm run dev`; any address works for the check).
    const previewUrl = process.env.EMAKI_E2E_PREVIEW_URL;
    if (previewUrl) {
      await vscode.workspace.getConfiguration('emaki.preview').update('url', previewUrl, vscode.ConfigurationTarget.Global);
      const ed = await vscode.window.showTextDocument(doc);
      ed.selection = new vscode.Selection(pos('There\'s a letter', 0), pos('There\'s a letter', 0));
      await vscode.commands.executeCommand('emaki.previewLine');
      const tab = await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs)
        .find((t) => !(t.input instanceof vscode.TabInputText)), 5000); // the built-in browser's tab type varies by version
      log('preview from line', pos('There\'s a letter', 0).line + 1 + ':', tab ? `opened "${tab.label}" in column ${tab.group.viewColumn}` : 'NO PREVIEW TAB');
      await sleep(800);
      log('  groups:', vscode.window.tabGroups.all.map((g) => `col ${g.viewColumn}: ${g.tabs.map((t) => t.label).join(', ')}`).join(' | '));
      if (!tab) {
        log('  tabs:', vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => `${t.label} [${t.input?.constructor?.name} ${t.input?.viewType ?? ''}]`).join(' | '));
        log('  simpleBrowser commands:', (await vscode.commands.getCommands(true)).filter((c) => /simpleBrowser/i.test(c)).join(', '));
      }
    }

    log('file unchanged at end:', doc.getText() === original && !doc.isDirty);
  } catch (e) {
    log('ERROR', e && e.stack || e);
  } finally {
    fs.writeFileSync(report, out.join('\n') + '\n');
  }
};
