import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const isolationArgs = [
  '--guest', '--enable-automation', '--disable-sync', '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-features=msImplicitSignin,msForceBrowserSignIn',
];

export async function checkBrowserIsolation(driver, browserProfile, origins = []) {
  const { arguments: args } = await driver.send('Browser.getBrowserCommandLine');
  for (const flag of [...isolationArgs, `--user-data-dir=${browserProfile}`]) {
    assert.ok(args.includes(flag), `Owned browser must use ${flag}`);
  }
  const { targetInfos } = await driver.send('Target.getTargets');
  const unexpected = targetInfos.filter(target => {
    if (/^(chrome|extension|edge)-extension:/.test(target.url)) return true;
    if (target.type !== 'page') return false;
    return target.url !== 'about:blank' && !origins.some(origin => target.url.startsWith(`${origin}/`));
  });
  // Do not write unexpected URLs: they may contain synced personal data.
  const unexpectedKinds = unexpected.map(t => ({type: t.type, scheme: t.url.split(':')[0]}));
  assert.equal(unexpected.length, 0, `Owned browser must have no extension targets or unexpected tabs: ${JSON.stringify(unexpectedKinds)}`);
  return { verifiedFlags: isolationArgs, browserProfile, pages: targetInfos.filter(t => t.type === 'page').length, unexpectedTargets: 0 };
}

// Read only the disposable profile, after browser shutdown has flushed it.
// Retain counts/booleans as evidence, never account names or tokens.
export function checkProfileIsolation(browserProfile) {
  const state = JSON.parse(fs.readFileSync(path.join(browserProfile, 'Local State'), 'utf8'));
  const profiles = Object.entries(state.profile?.info_cache ?? {});
  assert.ok(fs.existsSync(path.join(browserProfile, 'Guest Profile')), 'Browser must create the owned Guest Profile');
  let accounts = 0, signedInProfiles = 0, installedExtensions = 0;
  for (const [, info] of profiles) {
    if (info.user_name || info.gaia_id || info.is_consented_primary_account || info.edge_account_cid || info.edge_account_oid) signedInProfiles++;
  }
  for (const directory of ['Default', 'Guest Profile']) {
    assert.equal(path.basename(directory), directory, 'Profile directory must be local');
    const file = path.join(browserProfile, directory, 'Preferences');
    // Guest preferences normally stay in memory; inspect any persisted file too.
    if (!fs.existsSync(file)) continue;
    const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prefs.google?.services?.username || prefs.signin?.signedin) signedInProfiles++;
    accounts += (prefs.account_info ?? []).length;
    // Chromium component extensions (location 5) are browser-owned, not synced
    // installations. --disable-extensions blocks user extensions at runtime.
    installedExtensions += Object.values(prefs.extensions?.settings ?? {}).filter(e => e.location !== 5).length;
  }
  assert.equal(accounts, 0, 'Disposable profile must contain no signed-in accounts');
  assert.equal(signedInProfiles, 0, 'Disposable profile must remain signed out');
  assert.equal(installedExtensions, 0, 'Disposable profile must contain no installed user extensions');
  return { guestProfile: true, registeredProfiles: profiles.length, accounts, signedInProfiles, installedExtensions };
}
