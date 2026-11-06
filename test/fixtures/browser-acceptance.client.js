window.__ModuleLoader__.load({
  id: 'no-workspace-qa-client',
  factory: () => ({
    inject: ['uiWorkspace', 'sessions', 'workspaces', 'conversation', 'slots', 'locale', 'configForms'],
    apply(ctx) {
      let resumeWorkspace;
      const originalOpenWorkspace = ctx.uiWorkspace.openWorkspace;
      const originalDescriptor = Object.getOwnPropertyDescriptor(ctx.uiWorkspace, 'openWorkspace');
      function restoreWorkspaceNavigation() {
        if (originalDescriptor) Object.defineProperty(ctx.uiWorkspace, 'openWorkspace', originalDescriptor);
        else delete ctx.uiWorkspace.openWorkspace;
      }
      const current = () => Object.values(ctx.sessions.list.getSnapshot().byId)
        .find(row => (row.retainedBy.mainView || 0) > 0)?.id;
      window.__noWorkspaceQa = {
        async setLocale(id) {
          // LocaleRuntime publishes optimistically and discards the settings
          // promise. Observe the actual native write, without issuing a second
          // write or treating the transient document language as completion.
          const scope = ctx.configForms.get('locale');
          const descriptor = Object.getOwnPropertyDescriptor(scope, 'set');
          const original = scope.set;
          let pending;
          scope.set = function (...args) { return pending = original.apply(this, args); };
          try { ctx.locale.setLocale(id); }
          finally {
            if (descriptor) Object.defineProperty(scope, 'set', descriptor);
            else delete scope.set;
          }
          if (!pending || !await pending) throw new Error('Native locale preference was not saved');
          return ctx.locale.getSnapshot().active;
        },
        async start(options, workspaceId) {
          await ctx.uiWorkspace.startSession(workspaceId, options);
          return current();
        },
        current,
        workspaceOf: id => ctx.workspaces.list.getSnapshot().items.find(w => w.sessionIds.includes(id))?.title,
        workspaceTitle: id => ctx.workspaces.list.getSnapshot().items.find(w => w.workspaceId === id)?.title,
        holdWorkspaceNavigation() {
          const pending = new Promise(resolve => { resumeWorkspace = resolve; });
          ctx.uiWorkspace.openWorkspace = async function (...args) {
            await pending;
            return originalOpenWorkspace.apply(this, args);
          };
        },
        resumeWorkspaceNavigation() {
          restoreWorkspaceNavigation();
          resumeWorkspace?.();
          resumeWorkspace = undefined;
        },
        listed: id => !!ctx.sessions.list.getSnapshot().byId[id],
        opened: id => ctx.sessions.binding(id)?.session.getSnapshot().openState === 'open',
        open: id => ctx.uiWorkspace.openSession(id),
        creator() {
          const entry = ctx.slots.entries('settings.section').find(entry => entry.options.id === 'agent-presets');
          const creator = entry?.inject?.().startCreatorDraft;
          if (typeof creator !== 'function') throw new Error('Native preset creator is unavailable');
          creator();
        },
        blanks: () => Object.values(ctx.sessions.list.getSnapshot().byId).filter(row => row.blank)
          .map(row => ({ id: row.id, preset: row.projectionValues?.agentPreset })),
        workspaceCount: () => ctx.workspaces.list.getSnapshot().items.length,
      };
      ctx.effect(() => () => {
        if (resumeWorkspace) window.__noWorkspaceQa.resumeWorkspaceNavigation();
        delete window.__noWorkspaceQa;
      });
    },
  }),
});
