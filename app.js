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

const formatHtml = (html) => {
  const compact = html.replace(/>\s+</g, '><').trim();
  if (!compact) return '';

  const inlineTags = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'small', 'mark', 'code']);
  const tokens = compact.split(/(<[^>]+>)/g).filter(Boolean);
  let depth = 0;
  let result = '';

  tokens.forEach((token) => {
    if (!token.startsWith('<')) {
      result += token;
      return;
    }

    const match = token.match(/^<\/?\s*([\w-]+)/);
    const tag = match?.[1]?.toLowerCase();
    const isClosing = /^<\//.test(token);
    const isVoid = /\/>$/.test(token) || ['br', 'hr', 'img', 'input'].includes(tag);
    const isInline = inlineTags.has(tag);

    if (isInline) {
      result += token;
      return;
    }

    if (isClosing) depth = Math.max(0, depth - 1);
    result += `${result && !result.endsWith('\n') ? '\n' : ''}${'  '.repeat(depth)}${token}`;
    if (!isClosing && !isVoid) depth += 1;
  });

  return result.trim();
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
  output.value = formatHtml(cleanHtml(editor.innerHTML));
  setStatus(true);
  if (!silent) {
    output.focus();
    showToast('已转换为 HTML');
  }
};

const convertToVisual = (silent = false) => {
  editor.innerHTML = cleanHtml(output.value) || '<p><br></p>';
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
  applyInlineStyle('color', event.target.value);
});

document.querySelector('#highlightColor').addEventListener('input', (event) => {
  document.querySelector('#highlightColorBar').style.background = event.target.value;
  applyInlineStyle('backgroundColor', event.target.value);
});

editor.addEventListener('input', () => { updateCount(); setStatus(false, 'visual'); });
editor.addEventListener('keyup', () => { saveSelection(); updateToolbarState(); });
editor.addEventListener('mouseup', () => { saveSelection(); updateToolbarState(); });
editor.addEventListener('blur', saveSelection);
output.addEventListener('input', () => setStatus(false, 'html'));

document.querySelector('#convertToHtml').addEventListener('click', convertToHtml);
document.querySelector('#convertToVisual').addEventListener('click', convertToVisual);

document.querySelector('#clearEditor').addEventListener('click', () => {
  editor.innerHTML = '';
  output.value = '';
  updateCount();
  setStatus(true);
  editor.focus();
});

document.querySelector('#copyHtml').addEventListener('click', () => {
  if (!output.value.trim() || dirtySource === 'visual') convertToHtml(true);
  copyPlainText(output.value, 'HTML 已复制');
});

document.querySelector('#copyRichText').addEventListener('click', async () => {
  const html = cleanHtml(dirtySource === 'html' ? output.value : editor.innerHTML);
  const container = document.createElement('div');
  container.innerHTML = html;
  const plain = container.innerText;

  try {
    if (window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } else {
      const range = document.createRange();
      container.style.position = 'fixed';
      container.style.opacity = '0';
      document.body.appendChild(container);
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      container.remove();
    }
    showToast('富文本已复制');
  } catch {
    await copyPlainText(plain, '已复制纯文本（浏览器未开放富文本剪贴板）');
  }
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
