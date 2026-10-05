// dsh-plugin-no-workspace — client half.
//
// Keep DSH's native components mounted. Wrapping the existing slot entries in
// place preserves their children, stores, actions, locale, and directory flow.

const ROUTE = '/no-workspace';
const NO_WORKSPACE_ID = '::dsh-no-workspace';
const WRAPPED = Symbol.for('dsh-plugin-no-workspace.wrapped');

const CSS = `
:root {
  --dsh-nw-folder-off-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v1z'/%3E%3Cpath d='M3 3l18 18'/%3E%3C/svg%3E");
}
button[data-dsh-nw-chip] > svg:first-of-type { display: none; }
button[data-dsh-nw-chip]::before {
  content: '';
  flex: none;
  width: 16px;
  height: 16px;
  opacity: 0.9;
  background-color: currentColor;
  -webkit-mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
  mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
}

/* DSH's native picker renders every item as a Workspace folder. Restyle only
   the synthetic No Workspace row so it matches the trigger semantics. */
button[data-dsh-nw-picker-item] > span:first-child > svg { display: none; }
button[data-dsh-nw-picker-item] > span:first-child::before {
  content: '';
  display: block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  -webkit-mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
  mask: var(--dsh-nw-folder-off-mask) center / contain no-repeat;
}

/* Keep DSH's native browser and session rows, but remove the redundant
   Ungrouped project-row wrapper around standalone conversations. */
[data-dsh-nw-ungrouped] > [role='treeitem'][aria-expanded] { display: none; }

/* With the project row gone, the leading status slot is pure indentation, and
   it lines standalone rows up under the Workspace above them as if they were
   its children. Drop the slot when it is empty, exactly as DSH's own flat list
   does, so the rows sit outside the folder hierarchy. Rows that are running
   keep their slot: the status dots there are content, not indentation. */
[data-dsh-nw-ungrouped] [role='treeitem'][aria-selected] > span:first-child:empty { display: none; }
[data-dsh-nw-ungrouped] [role='treeitem'][aria-selected] > span:first-child:empty + span { margin-left: 0; }

/* DSH pads its "show N more" button to clear the same slot. Pull it back by
   the slot's width plus the title gap so it stays on the rows' new margin. */
[data-dsh-nw-ungrouped] > button[aria-expanded] { padding-left: 8px; }
`;

function getLocale() {
  try {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch (_) {
    return 'en';
  }
}

async function postJson(path, body) {
  const response = await fetch(ROUTE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || ('Request failed with status ' + response.status));
  }
  return result;
}

function installStandaloneNavigation(ctx) {
  const navigation = ctx.uiWorkspace;
  const originalStart = navigation.startSession;
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigation, 'startSession');
  let active = true;
  let standaloneCreation = null;
  let workspaceSelection = null;

  function currentSessionId() {
    const byId = ctx.sessions.list.getSnapshot().byId;
    return Object.keys(byId).find(function (id) { return (byId[id].retainedBy.mainView || 0) > 0; });
  }

  function reusableStandaloneBlank() {
    const sessions = ctx.sessions.list.getSnapshot();
    const workspaces = ctx.workspaces.list.getSnapshot();
    const attached = new Set(workspaces.items.flatMap(function (workspace) { return workspace.sessionIds; }));
    const archived = new Set(workspaces.archivedSessionIds);
    return sessions.ids.find(function (id) {
      const summary = sessions.byId[id];
      return summary && summary.blank && summary.origin !== 'subagent'
        && !attached.has(id) && !archived.has(id);
    });
  }

  async function waitForWorkspaceSelection() {
    while (active && workspaceSelection) await workspaceSelection.promise;
  }

  async function openStandaloneSession() {
    await waitForWorkspaceSelection();
    if (!active) return;
    const reusable = reusableStandaloneBlank();
    if (reusable) {
      navigation.openSession(reusable);
      return reusable;
    }
    if (standaloneCreation) return standaloneCreation;
    standaloneCreation = postJson('/create', {}).then(function (result) {
      if (active) navigation.openSession(result.sessionId);
      return result.sessionId;
    }).finally(function () { standaloneCreation = null; });
    return standaloneCreation;
  }

  async function selectNoWorkspace(props) {
    if (!active) return;
    if (props.onClose) props.onClose();
    await waitForWorkspaceSelection();
    if (!active) return;
    const current = currentSessionId();
    if (!current) return openStandaloneSession();
    // Membership can lag behind main-view retention; the idempotent host route
    // decides whether the selected conversation still belongs to a workspace.
    await postJson('/detach', { sessionId: current });
    if (active) navigation.openSession(current);
  }

  // The picker changes its optimistic chip before navigation retains the new
  // main conversation. Wait for both feeds before a following standalone action.
  function trackWorkspaceSelection(workspaceId) {
    if (!active) return;
    if (workspaceSelection) workspaceSelection.finish();
    const disposers = [];
    let resolve;
    let reject;
    let timer;
    const transition = { promise: new Promise(function (yes, no) { resolve = yes; reject = no; }), finish: finish };
    workspaceSelection = transition;
    function finish(error) {
      if (workspaceSelection !== transition) return;
      workspaceSelection = null;
      clearTimeout(timer);
      disposers.splice(0).forEach(function (dispose) { dispose(); });
      if (error) reject(error); else resolve();
    }
    function check() {
      const current = currentSessionId();
      const destination = ctx.workspaces.list.getSnapshot().items.find(function (w) { return w.workspaceId === workspaceId; });
      if (current && destination && destination.sessionIds.includes(current)) finish();
    }
    // Failures are reported by the following action, when there is one.
    transition.promise.catch(function () {});
    timer = setTimeout(function () { finish(new Error('Workspace navigation did not complete; please select the workspace again.')); }, 15000);
    disposers.push(ctx.sessions.list.subscribe(check), ctx.workspaces.list.subscribe(check));
    check();
    return finish;
  }

  function startSession(workspaceId) {
    if (!active || workspaceId !== undefined) return originalStart.apply(this, arguments);
    return openStandaloneSession().catch(function (error) {
      if (active) console.error('standalone session creation failed:', error);
    });
  }
  // Buttons, native menus, rebound chords and browser shortcuts all dispatch
  // here, after DSH has applied its own input ownership and composition rules.
  navigation.startSession = startSession;

  return {
    selectNoWorkspace: function (props) {
      return selectNoWorkspace(props).catch(function (error) {
        if (active) console.error('no-workspace selection failed:', error);
      });
    },
    trackWorkspaceSelection: trackWorkspaceSelection,
    dispose: function () {
      if (!active) return;
      active = false;
      if (workspaceSelection) workspaceSelection.finish();
      // Cordis returns a fresh tracing proxy when a method is read. Compare
      // the stored descriptor so disposal also works for real Service objects.
      if (Object.getOwnPropertyDescriptor(navigation, 'startSession')?.value === startSession) {
        if (originalDescriptor) Object.defineProperty(navigation, 'startSession', originalDescriptor);
        else delete navigation.startSession;
      }
    },
  };
}

const syntheticSnapshots = new WeakMap();
function syntheticWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const cached = syntheticSnapshots.get(snapshot);
  if (cached) return cached;
  const synthetic = {
    workspaceId: NO_WORKSPACE_ID,
    title: getLocale() === 'zh' ? '\u65e0\u5de5\u4f5c\u533a' : 'No Workspace',
    path: '',
    sessionIds: [],
  };
  const transformed = Object.assign({}, snapshot, {
    items: [synthetic].concat((snapshot.items || []).filter(function (item) {
      return item && item.workspaceId !== NO_WORKSPACE_ID;
    })),
  });
  syntheticSnapshots.set(snapshot, transformed);
  return transformed;
}

function wrapComposerEntry(entry) {
  if (!entry || entry[WRAPPED]) return function () {};
  const NativeComposer = entry.component;
  function StandaloneComposer(props) {
    const unlock = props.sessionId !== undefined && props.disabled === true;
    if (!unlock) return React.createElement(NativeComposer, props);
    return React.createElement(NativeComposer, Object.assign({}, props, {
      disabled: false,
      workspacePickerOpen: false,
      onRequestWorkspace: undefined,
      placeholder: getLocale() === 'zh'
        ? '\u63cf\u8ff0\u4f60\u60f3\u8981\u6784\u5efa\u7684\u5185\u5bb9'
        : 'Send a message to start chatting...',
    }));
  }
  StandaloneComposer.displayName = 'NoWorkspaceComposer(' + (NativeComposer.displayName || NativeComposer.name || 'Native') + ')';
  entry.component = StandaloneComposer;
  entry[WRAPPED] = { kind: 'composer', original: NativeComposer };
  return function () {
    if (entry.component === StandaloneComposer) entry.component = NativeComposer;
    delete entry[WRAPPED];
  };
}

function wrapWorkspacePickerEntry(entry, navigation) {
  if (!entry || entry[WRAPPED]) return function () {};
  const NativePicker = entry.component;
  function NoWorkspacePicker(props) {
    const nativeUseWorkspaces = props.useWorkspaces;
    function useWorkspaces(selector, equality) {
      return nativeUseWorkspaces(function (snapshot) {
        return selector(syntheticWorkspaceSnapshot(snapshot));
      }, equality);
    }
    const nativeOnPick = props.onPick;
    return React.createElement(NativePicker, Object.assign({}, props, {
      useWorkspaces: useWorkspaces,
      selectedId: props.selectedId || NO_WORKSPACE_ID,
      onPick: function (workspaceId) {
        if (workspaceId === NO_WORKSPACE_ID) {
          return navigation.selectNoWorkspace(props);
        }
        const finish = navigation.trackWorkspaceSelection(workspaceId);
        try {
          return nativeOnPick(workspaceId);
        } catch (error) {
          if (finish) finish(error);
          throw error;
        }
      },
    }));
  }
  NoWorkspacePicker.displayName = 'NoWorkspacePicker(' + (NativePicker.displayName || NativePicker.name || 'Native') + ')';
  entry.component = NoWorkspacePicker;
  entry[WRAPPED] = { kind: 'picker', original: NativePicker };
  return function () {
    if (entry.component === NoWorkspacePicker) entry.component = NativePicker;
    delete entry[WRAPPED];
  };
}

function patchNativeEntry(ctx, slotName, patch) {
  const restorers = new Map();
  function reconcile() {
    const entries = ctx.slots.entries(slotName) || [];
    entries.forEach(function (entry) {
      if ((entry.options.priority || 0) !== 0 || restorers.has(entry)) return;
      restorers.set(entry, patch(entry));
    });
  }
  reconcile();
  const unsubscribe = ctx.slots.subscribe(slotName, reconcile);
  return function () {
    if (typeof unsubscribe === 'function') unsubscribe();
    restorers.forEach(function (restore) { restore(); });
    restorers.clear();
  };
}

function markNoWorkspaceUi() {
  if (typeof document === 'undefined') return function () {};
  let active = true;
  let queued = false;
  function update() {
    queued = false;
    if (!active) return;
    document.querySelectorAll('button[aria-haspopup="menu"]').forEach(function (button) {
      const label = button.querySelector('span');
      const text = label ? (label.textContent || '').trim() : '';
      const placeholder = text === '\u9009\u62e9\u5de5\u4f5c\u533a' || text === 'Choose workspace'
        || text === '\u65e0\u5de5\u4f5c\u533a' || text === 'No Workspace';
      if (placeholder) {
        const wanted = getLocale() === 'zh' ? '\u65e0\u5de5\u4f5c\u533a' : 'No Workspace';
        // Updating the text node is safe; unlike replacing the glyph element,
        // it does not restructure React's child tree. Keeping this native span
        // also preserves DSH's icon -> label -> chevron flex order.
        if (label.textContent !== wanted) label.textContent = wanted;
        if (!button.hasAttribute('data-dsh-nw-chip')) button.setAttribute('data-dsh-nw-chip', '');
        button.setAttribute('aria-label', wanted);
      } else if (button.hasAttribute('data-dsh-nw-chip')) {
        button.removeAttribute('data-dsh-nw-chip');
      }
    });

    // The picker does not expose item ids in its DOM. Mark the one row with our
    // exact localized label; attributes and CSS avoid replacing React nodes.
    document.querySelectorAll('button[role="menuitem"]').forEach(function (button) {
      const text = (button.innerText || button.textContent || '').trim();
      const noWorkspace = text === '\u65e0\u5de5\u4f5c\u533a' || text === 'No Workspace';
      if (noWorkspace) button.setAttribute('data-dsh-nw-picker-item', '');
      else if (button.hasAttribute('data-dsh-nw-picker-item')) button.removeAttribute('data-dsh-nw-picker-item');
    });

    // Ungrouped is an implementation bucket, not a user-facing Workspace.
    // Keep it expanded so its native SessionNodeItems remain mounted, then hide
    // only the project header through CSS. Real Workspace groups are untouched.
    document.querySelectorAll('[role="treeitem"][aria-expanded]').forEach(function (row) {
      const text = (row.innerText || row.textContent || '').trim();
      const ungrouped = text === '\u672a\u5206\u7ec4' || text === 'Ungrouped';
      const section = row.parentElement;
      if (!section) return;
      if (ungrouped) {
        section.setAttribute('data-dsh-nw-ungrouped', '');
        if (row.getAttribute('aria-expanded') === 'false' && !row.hasAttribute('data-dsh-nw-expanding')) {
          row.setAttribute('data-dsh-nw-expanding', '');
          row.click();
        }
      } else if (section.hasAttribute('data-dsh-nw-ungrouped')) {
        section.removeAttribute('data-dsh-nw-ungrouped');
      }
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
  update();
  return function () { active = false; observer.disconnect(); };
}

return {
  inject: ['slots', 'sessions', 'workspaces', 'uiWorkspace'],
  apply: function (ctx) {
    const navigation = installStandaloneNavigation(ctx);
    const disposers = [styles.insert(CSS), markNoWorkspaceUi()];
    ctx.slots.inject('conversation.composer.bar', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.composer.bar', wrapComposerEntry);
      disposers.push(dispose);
      return dispose;
    });
    ctx.slots.inject('conversation.hero.workspace', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.hero.workspace', function (entry) {
        return wrapWorkspacePickerEntry(entry, navigation);
      });
      disposers.push(dispose);
      return dispose;
    });

    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      navigation.dispose();
      disposers.splice(0).reverse().forEach(function (dispose) {
        if (typeof dispose === 'function') dispose();
      });
    }
    ctx.effect(function () { return dispose; }, 'no-workspace: client adapters');
    return dispose;
  },
};
