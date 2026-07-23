const editor = document.querySelector('#visualEditor');
const output = document.querySelector('#htmlOutput');
const statusBadge = document.querySelector('#statusBadge');
const charCount = document.querySelector('#charCount');
const toast = document.querySelector('#toast');
const toastText = document.querySelector('#toastText');
let savedRange = null;
let toastTimer = null;
let dirtySource = null;

const cleanHtml = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || (['href', 'src'].includes(name) && value.startsWith('javascript:'))) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML.trim();
};

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const colorToHex = (value) => {
  if (!value) return '';
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) return `#${[...hex].map((item) => item.repeat(2)).join('').toUpperCase()}`;
    return `#${hex.slice(0, 6).toUpperCase()}`;
  }

  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) return '';
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

const sameStyle = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const getNodeStyle = (node, inherited) => {
  const style = { ...inherited };
  const tag = node.tagName.toLowerCase();
  const decoration = node.style.textDecoration || node.style.textDecorationLine || '';

  if (['strong', 'b'].includes(tag) || ['bold', '700', '800', '900'].includes(node.style.fontWeight)) style.bold = true;
  if (['em', 'i'].includes(tag) || node.style.fontStyle === 'italic') style.italic = true;
  if (tag === 'u' || decoration.includes('underline')) style.underline = true;
  if (['s', 'strike'].includes(tag) || decoration.includes('line-through')) style.strike = true;
  if (tag === 'h1') Object.assign(style, { bold: true, size: '32' });
  if (tag === 'h2') Object.assign(style, { bold: true, size: '24' });
  if (tag === 'h3') Object.assign(style, { bold: true, size: '20' });
  if (node.style.color) style.color = colorToHex(node.style.color);
  if (node.style.backgroundColor) style.background = colorToHex(node.style.backgroundColor);
  if (node.style.fontSize) style.size = node.style.fontSize.replace('px', '');
  if (node.style.textAlign) style.align = node.style.textAlign;
  if (node.style.lineHeight) style.lineHeight = node.style.lineHeight;

  return style;
};

const wrapGameText = (text, style) => {
  if (!text) return '';
  const tags = [];
  if (style.align && style.align !== 'left' && style.align !== 'start') tags.push(['align', style.align]);
  if (style.lineHeight && style.lineHeight !== 'normal') tags.push(['lineheight', style.lineHeight]);
  if (style.size) tags.push(['size', style.size]);
  if (style.bold) tags.push(['b']);
  if (style.italic) tags.push(['i']);
  if (style.underline) tags.push(['u']);
  if (style.strike) tags.push(['s']);
  if (style.background) tags.push(['bgcolor', style.background]);
  if (style.color) tags.push(['color', style.color]);

  const opening = tags.map(([name, value]) => value ? `[${name}=${value}]` : `[${name}]`).join('');
  const closing = [...tags].reverse().map(([name]) => `[/${name}]`).join('');
  return `${opening}${text}${closing}`;
};

const htmlToGameText = (html) => {
  const template = document.createElement('template');
  template.innerHTML = cleanHtml(html);
  const runs = [];
  const blockTags = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote']);

  const addRun = (text, style = {}) => {
    if (!text) return;
    const previous = runs.at(-1);
    if (previous && sameStyle(previous.style, style) && !previous.text.endsWith('\n')) previous.text += text;
    else runs.push({ text, style: { ...style } });
  };

  const walk = (node, inherited = {}, listContext = null) => {
    if (node.nodeType === Node.TEXT_NODE) {
      addRun(node.nodeValue.replace(/\u200B/g, ''), inherited);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      addRun('\n');
      return;
    }

    const style = getNodeStyle(node, inherited);
    if (tag === 'li') {
      const index = [...node.parentElement.children].indexOf(node) + 1;
      addRun(listContext === 'ol' ? `${index}. ` : '• ');
    }

    [...node.childNodes].forEach((child) => walk(child, style, ['ol', 'ul'].includes(tag) ? tag : listContext));
    if (blockTags.has(tag) || tag === 'li') addRun('\n');
  };

  [...template.content.childNodes].forEach((node) => walk(node));
  return runs.map(({ text, style }) => text === '\n' ? text : wrapGameText(text, style))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
};

const gameTextToHtml = (gameText) => {
  const tagPattern = /\[(\/)?(color|bgcolor|size|align|lineheight|b|i|u|s|quote)(?:=([^\]]+))?\]/gi;
  const stack = [];
  let html = '';
  let cursor = 0;
  let match;

  const openTag = (name, value = '') => {
    const safeValue = value.replace(/["'<>]/g, '');
    const safeColor = /^#[0-9a-f]{6}$/i.test(safeValue) ? safeValue.toUpperCase() : '#000000';
    const safeSize = Math.min(96, Math.max(8, Number.parseFloat(safeValue) || 16));
    const tags = {
      color: `<span style="color:${safeColor}">`,
      bgcolor: `<span style="background-color:${safeColor}">`,
      size: `<span style="font-size:${safeSize}px">`,
      align: `<span style="display:block;text-align:${['left', 'center', 'right'].includes(safeValue) ? safeValue : 'left'}">`,
      lineheight: `<span style="display:block;line-height:${Number.parseFloat(safeValue) || 1.75}">`,
      b: '<strong>',
      i: '<em>',
      u: '<u>',
      s: '<s>',
      quote: '<blockquote>',
    };
    return tags[name] || '';
  };

  const closeTag = (name) => ['color', 'bgcolor', 'size', 'align', 'lineheight'].includes(name)
    ? '</span>'
    : `</${{ b: 'strong', i: 'em', u: 'u', s: 's', quote: 'blockquote' }[name]}>`;

  while ((match = tagPattern.exec(gameText)) !== null) {
    html += escapeHtml(gameText.slice(cursor, match.index));
    const [, closing, rawName, value = ''] = match;
    const name = rawName.toLowerCase();
    if (!closing) {
      html += openTag(name, value);
      stack.push(name);
    } else {
      const position = stack.lastIndexOf(name);
      if (position !== -1) {
        const pending = stack.splice(position);
        pending.reverse().forEach((pendingName) => { html += closeTag(pendingName); });
      }
    }
    cursor = tagPattern.lastIndex;
  }

  html += escapeHtml(gameText.slice(cursor));
  stack.reverse().forEach((name) => { html += closeTag(name); });
  return cleanHtml(html.replaceAll('\n', '<br>'));
};

const setStatus = (synced, source = null) => {
  dirtySource = synced ? null : source;
  statusBadge.classList.toggle('is-dirty', !synced);
  statusBadge.lastChild.textContent = synced ? ' 已同步' : ' 待转换';
};

const updateCount = () => {
  const count = editor.innerText.replace(/\s/g, '').length;
  charCount.textContent = `${count} 字`;
};

const saveSelection = () => {
  const selection = window.getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }
};

const restoreSelection = () => {
  if (!savedRange) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
};

const runCommand = (command, value = null) => {
  editor.focus();
  restoreSelection();
  document.execCommand(command, false, value);
  saveSelection();
  updateToolbarState();
  updateCount();
  setStatus(false, 'visual');
};

const applyInlineStyle = (property, value) => {
  editor.focus();
  restoreSelection();
  const selection = window.getSelection();

  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    const span = document.createElement('span');
    span.style[property] = value;
    span.appendChild(document.createTextNode('\u200B'));
    range.insertNode(span);
    range.setStart(span.firstChild, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    const span = document.createElement('span');
    span.style[property] = value;
    try {
      range.surroundContents(span);
    } catch {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    selection.selectAllChildren(span);
  }

  saveSelection();
  updateCount();
  setStatus(false, 'visual');
};

const applyBlockStyle = (property, value) => {
  editor.focus();
  restoreSelection();
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  let node = selection.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const block = node?.closest('p, div, h1, h2, h3, blockquote, li') || editor;
  block.style[property] = value;
  setStatus(false, 'visual');
};

const updateToolbarState = () => {
  document.querySelectorAll('[data-command]').forEach((button) => {
    const command = button.dataset.command;
    if (['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'insertUnorderedList', 'insertOrderedList'].includes(command)) {
      button.classList.toggle('is-active', document.queryCommandState(command));
    }
  });
};

const convertToHtml = (silent = false) => {
  output.value = htmlToGameText(editor.innerHTML);
  setStatus(true);
  if (!silent) {
    output.focus();
    showToast('已转换为游戏富文本');
  }
};

const convertToVisual = (silent = false) => {
  editor.innerHTML = gameTextToHtml(output.value) || '<p><br></p>';
  updateCount();
  setStatus(true);
  if (!silent) {
    editor.focus();
    showToast('已转换为可视化富文本');
  }
};

const showToast = (message) => {
  toastText.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
};

const copyPlainText = async (text, successMessage) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    output.select();
    document.execCommand('copy');
    showToast(successMessage);
  }
};

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => runCommand(button.dataset.command));
});

document.querySelector('#formatBlock').addEventListener('change', (event) => {
  runCommand('formatBlock', `<${event.target.value}>`);
});

document.querySelector('#fontSize').addEventListener('change', (event) => {
  if (event.target.value) applyInlineStyle('fontSize', event.target.value);
  event.target.value = '';
});

document.querySelector('#lineHeight').addEventListener('change', (event) => {
  if (event.target.value) applyBlockStyle('lineHeight', event.target.value);
  event.target.value = '';
});

document.querySelector('#textColor').addEventListener('input', (event) => {
  document.querySelector('#textColorBar').style.background = event.target.value;
});
document.querySelector('#textColor').addEventListener('change', (event) => {
  applyInlineStyle('color', event.target.value);
});

document.querySelector('#highlightColor').addEventListener('input', (event) => {
  document.querySelector('#highlightColorBar').style.background = event.target.value;
});
document.querySelector('#highlightColor').addEventListener('change', (event) => {
  applyInlineStyle('backgroundColor', event.target.value);
});

editor.addEventListener('input', () => { updateCount(); setStatus(false, 'visual'); });
editor.addEventListener('keyup', () => { saveSelection(); updateToolbarState(); });
editor.addEventListener('mouseup', () => { saveSelection(); updateToolbarState(); });
editor.addEventListener('blur', saveSelection);
output.addEventListener('input', () => setStatus(false, 'html'));

document.querySelector('#convertToHtml').addEventListener('click', () => convertToHtml());
document.querySelector('#convertToVisual').addEventListener('click', () => convertToVisual());

document.querySelector('#clearEditor').addEventListener('click', () => {
  editor.innerHTML = '';
  output.value = '';
  updateCount();
  setStatus(true);
  editor.focus();
});

document.querySelector('#copyHtml').addEventListener('click', () => {
  if (!output.value.trim() || dirtySource === 'visual') convertToHtml(true);
  const plainText = output.value.replace(/\[\/?(?:color|bgcolor|size|align|lineheight|b|i|u|s|quote)(?:=[^\]]+)?\]/gi, '');
  copyPlainText(plainText, '纯文本已复制');
});

document.querySelector('#copyRichText').addEventListener('click', async () => {
  if (dirtySource === 'visual') convertToHtml(true);
  await copyPlainText(output.value, '游戏富文本代码已复制');
});

document.querySelector('#themeToggle').addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem('richly-theme', nextTheme);
});

const preferredTheme = localStorage.getItem('richly-theme')
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = preferredTheme;

updateCount();
convertToHtml(true);
