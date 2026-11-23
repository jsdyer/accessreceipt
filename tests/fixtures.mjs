import {FORMAT, normalizeReceipt} from '../web/model.mjs';
export const rule = (id = 'color-contrast', selector = '#headline', impact = 'serious') => ({id, impact, help: `${id} test finding`, description: 'Synthetic finding for automated tests only.', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast', tags: ['wcag2aa','wcag143'], nodes: [{target:[selector], impact, html:'<input value="private">', any:[{data:{value:'private'}}]}]});
export function receipt({date='2026-01-02T12:00:00Z', violations=[rule()], incomplete=[], pages, engine='4.14.1', profile}={}) {
  return normalizeReceipt({format:FORMAT,capturedAt:date,engine:{name:'axe-core',version:engine},profile: profile === undefined ? {viewport:{width:1280,height:900},tags:['wcag2aa','wcag2a'],scope:'document',settleMilliseconds:1500,browser:'Chromium test',policy:'public-read-v1',requestLimit:600} : profile,
    pages: pages || [{requestedURL:'https://example.com/',finalURL:'https://example.com/',label:'Synthetic fixture',status:'success',scannedAt:date,violations,incomplete,passedRules:4,inapplicableRules:8}]});
}
