import assert from 'node:assert/strict';

// Run in the owned Chromium tab before navigating to DSH. These fixtures exercise
// real layout, hit testing and CDP input, not mocked rectangle calculations.
export async function checkDriver(driver) {
  await driver.send('Page.navigate', { url: 'about:blank' });
  await driver.eval(`(() => {
    document.body.innerHTML = '<button id="other">No Workspace acceptance</button><div id="menu" style="position:absolute;left:100px;top:100px;visibility:hidden"><button id="target">No Workspace</button></div><div id="cover" style="position:absolute;inset:0;background:white"></div>';
    window.hits = [];
    document.querySelectorAll('button').forEach(e => e.onclick = () => hits.push(e.id));
  })()`);
  assert.equal(await driver.box('#target'), null, 'Hidden measurement menu is not actionable');
  await driver.eval(`document.querySelector('#menu').style.visibility = 'visible'`);
  assert.equal(await driver.box('#target'), null, 'Covered row is not actionable');
  await driver.eval(`document.querySelector('#cover').remove(); document.querySelector('#target').disabled = true`);
  assert.equal(await driver.box('#target'), null, 'Disabled row is not actionable');
  await driver.eval(`(() => {
    document.querySelector('#target').disabled = false;
    document.querySelector('#target').addEventListener('mouseenter', () => {
      document.querySelector('#menu').style.top = '220px';
    }, {once:true});
  })()`);
  await driver.clickText('button', 'No Workspace', { exact: true });
  assert.deepEqual(await driver.eval('hits'), ['target'], 'Hover movement is remeasured and the exact row receives one real click');
  await driver.eval(`document.querySelector('#menu').style.visibility='hidden'; setTimeout(() => {document.querySelector('#menu').style.visibility='visible'}, 150)`);
  await driver.click('#target');
  assert.deepEqual(await driver.eval('hits'), ['target', 'target'], 'Click waits for the menu to become actionable');
  // Background tabs may stop delivering frames entirely. Keep the target ready
  // so this exercises the frame wait, rather than the element lookup timeout.
  await driver.eval(`window.__qaRequestFrame = window.requestAnimationFrame; window.requestAnimationFrame = () => 0`);
  const started = Date.now();
  try {
    await assert.rejects(driver.click('#target', { timeoutMs: 350 }), /no stable actionable target/);
    assert.ok(Date.now() - started < 2000, 'Missing frames must respect the click deadline');
    assert.deepEqual(await driver.eval('hits'), ['target', 'target'], 'No input is dispatched without stable frames');
  } finally {
    await driver.eval(`window.requestAnimationFrame = window.__qaRequestFrame; delete window.__qaRequestFrame`);
  }
  await driver.click('#target');
  assert.deepEqual(await driver.eval('hits'), ['target', 'target', 'target'], 'Frame timeout leaves the next click usable');
}
