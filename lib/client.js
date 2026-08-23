window.__ModuleLoader__.load({
  id: 'dsh-plugin-no-workspace',
  factory: (require) => {
    const React = require('react');
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return function () {};
        const prev = document.querySelector('style[data-plugin="dsh-plugin-no-workspace"]');
        if (prev) {
          prev.textContent = css;
          return function () { prev.remove(); };
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-plugin-no-workspace';
        tag.textContent = css;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }
    };
    return (function () {
// dsh-plugin-no-workspace — client half.
//
// Keep DSH's native components mounted. Wrapping the existing slot entries in
// place preserves their children, stores, actions, locale, and directory flow.

const ROUTE = '/no-workspace';
const NO_WORKSPACE_ID = '::dsh-no-workspace';
const WRAPPED = Symbol.for('dsh-plugin-no-workspace.wrapped');

let _pluginCtx = null;
let _standaloneCreation = null;

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

function sessionListSnapshot() {
  const source = _pluginCtx && _pluginCtx.sessions && _pluginCtx.sessions.list;
  if (!source) return { ids: [], byId: {}, current: undefined };
  if (typeof source.getSnapshot === 'function') return source.getSnapshot();
  return source.snapshot || source;
}

function workspaceListSnapshot() {
  const source = _pluginCtx && _pluginCtx.workspaces && _pluginCtx.workspaces.list;
  if (!source) return { items: [], archivedSessionIds: [] };
  if (typeof source.getSnapshot === 'function') return source.getSnapshot();
  return source.snapshot || source;
}

function workspaceForSession(sessionId) {
  if (!sessionId) return undefined;
  return (workspaceListSnapshot().items || []).find(function (workspace) {
    return Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId);
  });
}

function openSession(sessionId) {
  if (sessionId && _pluginCtx && _pluginCtx.sessions && typeof _pluginCtx.sessions.open === 'function') {
    _pluginCtx.sessions.open(sessionId);
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

async function detachSession(sessionId) {
  const result = await postJson('/detach', { sessionId: sessionId });
  openSession(sessionId);
  return result;
}

function reusableStandaloneBlank() {
  const sessions = sessionListSnapshot();
  const workspaces = workspaceListSnapshot();
  const attached = new Set();
  (workspaces.items || []).forEach(function (workspace) {
    (workspace.sessionIds || []).forEach(function (id) { attached.add(id); });
  });
  const archived = new Set(workspaces.archivedSessionIds || []);
  return (sessions.ids || []).find(function (id) {
    const summary = sessions.byId && sessions.byId[id];
    return summary && summary.blank && summary.origin !== 'subagent'
      && !attached.has(id) && !archived.has(id);
  });
}

async function openStandaloneSession() {
  const reusable = reusableStandaloneBlank();
  if (reusable) {
    openSession(reusable);
    return reusable;
  }
  if (_standaloneCreation) return _standaloneCreation;
  _standaloneCreation = postJson('/create', {}).then(function (result) {
    openSession(result.sessionId);
    return result.sessionId;
  }).finally(function () {
    _standaloneCreation = null;
  });
  return _standaloneCreation;
}

async function selectNoWorkspace(props) {
  if (props.onClose) props.onClose();
  const current = sessionListSnapshot().current;
  if (!current) {
    await openStandaloneSession();
    return;
  }
  if (workspaceForSession(current)) await detachSession(current);
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

function wrapWorkspacePickerEntry(entry) {
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
          selectNoWorkspace(props).catch(function (error) {
            console.error('no-workspace selection failed:', error);
          });
          return;
        }
        nativeOnPick(workspaceId);
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

function wrapSidebarEntry(entry) {
  if (!entry || entry[WRAPPED]) return function () {};
  const nativeInject = entry.inject;
  if (typeof nativeInject !== 'function') return function () {};
  function standaloneInject() {
    const injected = nativeInject.apply(this, arguments);
    return Object.assign({}, injected, {
      startSession: function (workspaceId) {
        if (workspaceId !== undefined && typeof injected.startSession === 'function') {
          return injected.startSession(workspaceId);
        }
        return openStandaloneSession().catch(function (error) {
          console.error('standalone session creation failed:', error);
        });
      },
    });
  }
  entry.inject = standaloneInject;
  entry[WRAPPED] = { kind: 'sidebar', original: nativeInject };
  return function () {
    if (entry.inject === standaloneInject) entry.inject = nativeInject;
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
  let queued = false;
  function update() {
    queued = false;
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
  return function () { observer.disconnect(); };
}

return {
  inject: ['slots', 'sessions', 'workspaces'],
  apply: function (ctx) {
    _pluginCtx = ctx;
    const disposers = [styles.insert(CSS), markNoWorkspaceUi()];

    ctx.slots.inject('sidebar', function () {
      const dispose = patchNativeEntry(ctx, 'sidebar', wrapSidebarEntry);
      disposers.push(dispose);
      return dispose;
    });
    ctx.slots.inject('conversation.composer.bar', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.composer.bar', wrapComposerEntry);
      disposers.push(dispose);
      return dispose;
    });
    ctx.slots.inject('conversation.hero.workspace', function () {
      const dispose = patchNativeEntry(ctx, 'conversation.hero.workspace', wrapWorkspacePickerEntry);
      disposers.push(dispose);
      return dispose;
    });

    return function () {
      disposers.splice(0).reverse().forEach(function (dispose) {
        if (typeof dispose === 'function') dispose();
      });
      if (_pluginCtx === ctx) _pluginCtx = null;
    };
  },
};

    })();
  }
});
