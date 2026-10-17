import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderAIControls} from '../api/ai-controls.js';
const source=fs.readFileSync(new URL('../simple.html',import.meta.url),'utf8');
test('AI controls activate only when the server is configured and retain working actions',()=>{
  for(const configured of [false,true]){
    const doc=new JSDOM(renderAIControls(source,configured)).window.document;
    const controls=[...doc.querySelectorAll('[data-ai-control]')];
    assert.equal(controls.length,5);
    for(const button of controls){assert.equal(button.disabled,!configured);assert.match(button.getAttribute('onclick'),/^(askAI|reviewSignalAI)\(/);}
    assert.equal(doc.querySelector('#aiAnswer').textContent.includes('disabled'),!configured);
  }
});
