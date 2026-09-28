// Minimal board runtime: renders the <template id="board"> with the values of the board's logic class.
//
// Template syntax (a small subset of the design-canvas runtime the boards were authored in):
//   {{ expr }}                  text or attribute interpolation; expr is `true`, `false` or a dotted path into the values
//   <sc-if value="{{ expr }}">  keeps its children when expr is truthy
//   <sc-for list="{{ expr }}" as="x">  repeats its children once per item, bound to `x`
//   onclick / oninput / onchange="{{ fn }}"  event handlers; checked / disabled / open follow truthiness
//   :href / :src="{{ expr }}"  resource attributes, renamed by build.py so the inert template never fetches them
// The logic script defines `class Component extends DCLogic` with renderVals() → values; setState() re-renders.
(function () {
  'use strict';
  const EXPR = /\{\{\s*([^}]*?)\s*\}\}/g;
  const BOOL_ATTRS = new Set(['checked', 'disabled', 'open', 'selected', 'readonly', 'required']);

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
      schedule();
    }
    componentDidMount() {}
    renderVals() { return {}; }
  }

  function lookup(path, scopes) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === '') return '';
    const parts = path.split('.');
    for (const scope of scopes) {
      if (scope && Object.prototype.hasOwnProperty.call(scope, parts[0])) {
        let v = scope;
        for (const p of parts) { if (v == null) return undefined; v = v[p]; }
        return v;
      }
    }
    return undefined;
  }

  function interpolate(text, scopes) {
    const only = /^\{\{\s*([^}]*?)\s*\}\}$/.exec(text);
    if (only) return lookup(only[1], scopes);
    return text.replace(EXPR, (m, e) => { const v = lookup(e, scopes); return v == null ? '' : String(v); });
  }

  function walk(node, scopes) {
    // Returns the node(s) that replace `node`, evaluating the template in place.
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.data.includes('{{')) node.data = String(interpolate(node.data, scopes) ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (tag === 'sc-if') {
      const on = interpolate(node.getAttribute('value') || '', scopes);
      if (!on) { node.remove(); return; }
      const kids = Array.from(node.childNodes);
      node.replaceWith(...kids);
      kids.forEach((k) => walk(k, scopes));
      return;
    }
    if (tag === 'sc-for') {
      const list = interpolate(node.getAttribute('list') || '', scopes) || [];
      const as = node.getAttribute('as') || 'item';
      const tpl = Array.from(node.childNodes);
      const frag = document.createDocumentFragment();
      for (const item of list) {
        for (const k of tpl) {
          const c = k.cloneNode(true);
          frag.appendChild(c);
          walk(c, [{ [as]: item }, ...scopes]);
        }
      }
      node.replaceWith(frag);
      return;
    }
    for (const attr of Array.from(node.attributes)) {
      const { name, value } = attr;
      if (name.startsWith('hint-')) { node.removeAttribute(name); continue; }
      if (!value.includes('{{')) continue;
      const v = interpolate(value, scopes);
      if (name.startsWith(':')) {
        node.removeAttribute(name);
        node.setAttribute(name.slice(1), v == null ? '' : String(v));
      } else if (name.startsWith('on')) {
        node.removeAttribute(name);
        if (typeof v === 'function') node.addEventListener(name.slice(2), v);
      } else if (BOOL_ATTRS.has(name)) {
        if (v && v !== 'false') node.setAttribute(name, ''); else node.removeAttribute(name);
        if (name === 'checked') node.defaultChecked = !!(v && v !== 'false');
      } else if (name === 'value' && (tag === 'input' || tag === 'textarea')) {
        node.setAttribute('value', v == null ? '' : String(v));
      } else {
        node.setAttribute(name, v == null ? '' : String(v));
      }
    }
    Array.from(node.childNodes).forEach((k) => walk(k, scopes));
  }

  let component = null;
  let mount = null;
  let pending = false;

  function focusKey(el) {
    if (!el || el === document.body) return null;
    return { key: el.localName + '|' + (el.getAttribute('aria-label') || el.getAttribute('name') || el.id || el.textContent.trim().slice(0, 40)), start: el.selectionStart, end: el.selectionEnd };
  }

  function render() {
    pending = false;
    const vals = component.renderVals() || {};
    const tpl = document.getElementById('board');
    const frag = tpl.content.cloneNode(true);
    Array.from(frag.childNodes).forEach((k) => walk(k, [vals]));
    const focus = focusKey(document.activeElement);
    mount.replaceChildren(frag);
    if (focus) {
      const el = Array.from(mount.querySelectorAll(focus.key.split('|')[0])).find((e) => focusKey(e).key === focus.key);
      if (el) {
        el.focus({ preventScroll: true });
        if (focus.start != null && typeof el.setSelectionRange === 'function' && /^(text|search|tel|url|password)$/.test(el.type || 'text')) {
          try { el.setSelectionRange(focus.start, focus.end); } catch (e) { /* not a text field */ }
        }
      }
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  }

  function boot() {
    const props = JSON.parse(document.getElementById('board-props').textContent || '{}');
    const logic = document.getElementById('board-logic').textContent;
    const Component = new Function('DCLogic', logic + '\nreturn Component;')(DCLogic);
    component = new Component(props);
    mount = document.createElement('div');
    mount.id = 'board-root';
    document.body.appendChild(mount);
    render();
    component.componentDidMount();
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
