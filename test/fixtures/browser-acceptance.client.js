window.__ModuleLoader__.load({
  id: 'no-workspace-qa-client',
  factory: () => ({
    inject: ['uiWorkspace', 'sessions', 'workspaces', 'conversation', 'slots'],
    apply(ctx) {
      const current = () => Object.values(ctx.sessions.list.getSnapshot().byId)
        .find(row => (row.retainedBy.mainView || 0) > 0)?.id;
      window.__noWorkspaceQa = {
        async start(options, workspaceId) {
          await ctx.uiWorkspace.startSession(workspaceId, options);
          return current();
        },
        current,
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
      ctx.effect(() => () => { delete window.__noWorkspaceQa; });
    },
  }),
});
