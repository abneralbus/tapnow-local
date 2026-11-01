export function colabNotebookUrl(value='') {
  if (value === '') return 'https://colab.research.google.com/';
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Colab 笔记本地址无效');
  let url;
  try { url = new URL(value); } catch { throw new Error('Colab 笔记本地址无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'colab.research.google.com' || url.port || url.username || url.password) throw new Error('请填写 https://colab.research.google.com/ 下的笔记本地址');
  return url.href;
}
