import { readResponse, responseFailure, transportFailure, uncertainFailure, ClientError, thumbnailUrl, sameThumbnail } from './client-protocol.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,249}\.html$/;
const modifiedTime = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const compareNames = (a, b) => {
  const left = a.name.toLowerCase(), right = b.name.toLowerCase();
  return left < right ? -1 : left > right ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};
export function visiblePages(pages, query, sort = 'modified', direction = sort === 'name' ? 'ascending' : 'descending') {
  const sign = direction === 'ascending' ? 1 : -1;
  return pages.filter(page => page.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
    if (sort === 'name') return sign * compareNames(a, b);
    const left = sort === 'size' ? a.size : modifiedTime(a.modifiedAt);
    const right = sort === 'size' ? b.size : modifiedTime(b.modifiedAt);
    const leftKnown = Number.isFinite(left), rightKnown = Number.isFinite(right);
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    return (leftKnown ? sign * (left - right) : 0) || compareNames(a, b);
  });
}
export function mutationRequest(action, name, inventory, { htmlBase64 = null, backup = null } = {}) {
  if (!NAME.test(name) || !inventory.mutationsEnabled) throw new Error('Invalid filename or mutations are disabled.');
  const page = inventory.pages.find(page => page.name === name);
  if (action === 'upload' && inventory.pages.some(page => page.name.toLowerCase() === name.toLowerCase())) throw new Error('Destination exists. Select Replace on its row instead.');
  if (['replace', 'delete'].includes(action) && !page) throw new Error('Selected page is no longer in inventory.');
  if (action === 'restore' && (!backup || backup.name !== name)) throw new Error('Select the exact backup version.');
  return {
    action, name, confirmation: name, expectedRevision: page?.revision ?? inventory.missingVersions[name] ?? 'missing',
    expectedSha256: page?.sha256 ?? null, htmlBase64,
    backupId: backup?.id ?? null, backupSha256: backup?.sha256 ?? null,
  };
}
export function pageUrl(origin, name, currentOrigin) {
  if (origin !== currentOrigin || !NAME.test(name)) throw new Error('Unsafe inventory URL.');
  return `${origin}/${name}`;
}
export async function verifyResult(request, result, expectedThumbnail = undefined) {
  let sha = request.action === 'restore' ? request.backupSha256 : null;
  if (['upload', 'replace'].includes(request.action)) {
    const bytes = Uint8Array.from(atob(request.htmlBase64), char => char.charCodeAt(0));
    sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  }
  if (!result || result.verified !== true || result.name !== request.name || result.action !== request.action ||
      typeof result.transactionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.transactionId) ||
      result.revision !== result.transactionId || result.sha256 !== sha ||
      (expectedThumbnail !== undefined && !sameThumbnail(expectedThumbnail, result.thumbnail))) throw uncertainFailure(result?.transactionId);
}
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unknown';
  const size = value => !Number.isFinite(value) || value < 0 ? 'Unknown' :
    value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  const node = (tag, text) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; };
  let inventory = null, busy = false, fresh = false, pending = null, pendingThumbnail = null, selectedName = null, selectedBackupId = null, lastKnown = null, returnFocus = null;
  let sortKey = 'modified', sortDirection = 'descending';
  const status = (text, error = false) => { $('status').textContent = text; $('status').className = error ? 'status error' : 'status'; };
  const canMutate = () => !busy && fresh && inventory?.mutationsEnabled === true;
  const pageButtons = new Map(), backupButtons = new Map();
  const setBusy = value => { busy = value; $('refresh').disabled = value; render(); };
  async function api(route, body) {
    let response, data;
    try {
      response = await fetch('/_manager/api/' + route, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error',
        headers: body ? { 'Content-Type': 'application/json', 'X-Manager-Request': '1' } : {},
        ...(body ? { body: JSON.stringify(body), referrerPolicy: 'same-origin' } : {}),
      });
      data = await readResponse(response);
    } catch { throw transportFailure(Boolean(body)); }
    if (!response.ok) throw responseFailure(response.status, data, Boolean(body));
    return data;
  }
  function fields(target, entries) {
    target.replaceChildren();
    for (const [label, value] of entries) target.append(node('dt', label), node('dd', value ?? 'Unknown'));
  }
  function preview(version) {
    const result = node('span', 'Preview unavailable');
    result.className = 'preview'; result.setAttribute('role', 'img');
    result.setAttribute('aria-label', 'Static preview unavailable for this version');
    if (version?.sha256) result.setAttribute('data-sha256', version.sha256);
    const url = thumbnailUrl(version);
    if (url) {
      const image = node('img'); image.src = url; image.alt = `Static preview of ${version.name}, HTML SHA-256 ${version.sha256}`;
      image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        result.replaceChildren(); result.textContent = 'Preview unavailable (image request failed)';
        result.setAttribute('aria-label', result.textContent);
      });
      result.textContent = ''; result.replaceChildren(image);
      result.setAttribute('aria-label', image.alt);
    }
    return result;
  }
  function select(name, backupId = null) {
    if (selectedName !== name) lastKnown = null;
    selectedName = name; selectedBackupId = backupId;
    const current = inventory?.pages.find(page => page.name === name);
    if (current) lastKnown = current;
    render();
  }
  function review(action, name, trigger, backup = null) {
    if (!canMutate()) return;
    select(name, backup?.id ?? null);
    pending = mutationRequest(action, name, inventory, { backup });
    pendingThumbnail = backup?.thumbnail ?? null;
    returnFocus = trigger;
    $('confirm-title').textContent = `${action === 'delete' ? 'Delete' : 'Restore'} ${name}?`;
    $('selection').textContent = action === 'delete' ?
      'Removes the current page. Existing private backups remain within their restore window. Existing copies are not revoked.' :
      `Selected backup: ${backup.id}\nSize: ${size(backup.size)}; saved: ${date(backup.savedAt)}.\n` +
      (pending.expectedSha256 === null ? 'Current destination: Missing. Creates the missing page from this private backup.' :
        'Current destination: Exists. Replaces its reviewed version with this private backup; the current bytes are backed up.') +
      '\nExisting copies are not revoked.';
    fields($('review-fields'), [['Filename', name], ['Destination revision', pending.expectedRevision],
      ['Destination SHA-256', pending.expectedSha256 ?? 'Missing'],
      ...(backup ? [['Selected backup ID', backup.id], ['Backup SHA-256', backup.sha256]] : [])]);
    $('confirm-name').value = ''; $('confirm').disabled = true;
    $('confirm').textContent = action === 'delete' ? 'Delete page' : 'Confirm restore';
    $('review-preview').replaceChildren(preview(backup ?? inventory.pages.find(page => page.name === name)));
    $('confirmation').showModal(); $('confirm-name').focus();
  }
  function button(label, work, mutation = false) {
    const result = node('button', label); result.disabled = mutation ? !canMutate() : busy;
    if (mutation) {
      result.setAttribute('aria-describedby', 'read-only');
      if (result.disabled) result.title = !fresh ? 'Refresh inventory before making a change.' :
        busy ? 'Wait for the current operation.' : 'Hosted mutations are disabled pending approved activation.';
    }
    result.addEventListener('click', () => { if (!result.disabled) { try { work(result); } catch (error) { status(error.message, true); } } });
    return result;
  }
  function renderDetails() {
    const page = inventory?.pages.find(page => page.name === selectedName);
    const backups = (inventory?.backups ?? []).filter(backup => backup.name === selectedName);
    const backup = backups.find(item => item.id === selectedBackupId);
    if (!backup) selectedBackupId = null;
    const known = page ?? lastKnown, version = backup ?? known;
    $('detail-title').textContent = backup ? 'Selected backup' : page ? 'Selected page' : selectedName ? 'Selected page (missing)' : 'Selected page';
    $('page-details').replaceChildren();
    if (selectedName) {
      const heading = node('div'); heading.className = 'detail-heading';
      const text = node('div'), filename = node('div', selectedName); filename.className = 'detail-name';
      const url = node('div', pageUrl(inventory.origin, selectedName, location.origin)); url.className = 'detail-url';
      text.append(filename, url);
      if (backup || !page) {
        const state = node('div', `Current destination: ${page ? 'Exists' : 'Missing'}${backup ? '; viewing selected backup' : ''}`);
        state.className = 'detail-state'; text.append(state);
      }
      heading.append(preview(version), text);
      const file = node('section'); file.className = 'detail-section';
      const fileFields = node('dl');
      fields(fileFields, [
        [backup ? 'Backup size' : page ? 'Size' : 'Last-known size', version ? size(version.size) : 'Unknown'],
        [!page && !backup ? 'Last-known modified' : 'Modified', backup ? 'Unknown' : date(known?.modifiedAt)],
        ['Original upload', backup || known?.provenance !== 'upload' ? 'Unknown' : date(known?.uploadedAt)],
        ...(!backup && known?.provenance === 'replace' ? [['Replacement recorded', date(known.uploadedAt)]] : []),
        ...(backup ? [['Backup saved', date(backup.savedAt)], ['Saved by action', backup.action ?? 'Unknown']] : []),
      ]);
      file.append(node('h3', 'File / version'), fileFields);
      const provenance = node('section'); provenance.className = 'detail-section';
      const provenanceFields = node('dl');
      fields(provenanceFields, [['Source', backup ? 'Unknown' : known?.provenance],
        ['Recorded', backup ? 'Unknown' : date(known?.recordedAt)]]);
      provenance.append(node('h3', backup ? 'Backup provenance' : page ? 'Provenance' : 'Last-known provenance'), provenanceFields);
      $('page-details').append(heading, file, provenance);
    } else {
      $('page-details').append(node('p', inventory ? 'Select a page or private backup history.' : 'Inventory unavailable.'));
    }
    fields($('technical-fields'), [[backup || !page ? 'Destination revision' : 'Revision',
      inventory && selectedName ? page?.revision ?? inventory.missingVersions[selectedName] ?? 'Missing' : 'Unknown'],
      [backup ? 'Selected backup SHA-256' : page ? 'SHA-256' : 'Last-known SHA-256', version?.sha256],
      ...(backup ? [['Selected backup ID', backup.id], ['Destination SHA-256', page?.sha256 ?? 'Missing']] : []),
      ['Actor ID', backup ? 'Unknown' : known?.actor],
      ['PNG SHA-256', version?.thumbnail?.sha256],
      ['Inventory checked at', date(inventory?.checkedAt)], ['Origin', inventory?.origin],
      ['Unmanaged entries', inventory?.unmanagedEntries === undefined ? 'Unknown' : String(inventory.unmanagedEntries)],
      ['Mutations', !fresh ? 'Refresh required' : inventory?.mutationsEnabled ? 'Enabled' : 'Disabled']]);
    $('backups').replaceChildren(); $('backup-fields').replaceChildren();
    backupButtons.clear();
    for (const [index, item] of backups.entries()) {
      const row = node('tr'), name = node('td'), cell = node('div'), actions = node('td');
      row.className = item.id === selectedBackupId ? 'selected' : ''; cell.className = 'backup-cell';
      const choose = button(`Backup ${index + 1}`, () => { select(item.name, item.id); backupButtons.get(item.id)?.focus(); });
      backupButtons.set(item.id, choose);
      choose.className = 'backup-select'; choose.setAttribute('aria-pressed', String(item.id === selectedBackupId));
      choose.setAttribute('aria-label', `Select backup ${item.id} for ${item.name}`);
      cell.append(preview(item), choose); name.append(cell);
      const restore = button('Restore', trigger => review('restore', item.name, trigger, item), true);
      restore.setAttribute('aria-label', `Restore ${item.name} from backup ${item.id}`);
      actions.append(restore); row.append(name, node('td', size(item.size)), node('td', date(item.savedAt)), actions);
      $('backups').append(row);
      const technical = node('dl'); technical.className = 'detail-section';
      fields(technical, [['Backup', choose.textContent], ['ID', item.id], ['SHA-256', item.sha256], ['PNG SHA-256', item.thumbnail?.sha256],
        ['Saved', date(item.savedAt)], ['Action', item.action ?? 'Unknown']]);
      $('backup-fields').append(technical);
    }
    $('backup-empty').textContent = backups.length ? '' : 'No retained private backups for this page.';
    const names = [...new Set([...(inventory?.pages ?? []).map(item => item.name), ...(inventory?.backups ?? []).map(item => item.name)])].sort();
    if (selectedName && !names.includes(selectedName)) names.push(selectedName);
    $('backup-page').replaceChildren();
    for (const name of names) {
      const option = node('option', name + (inventory.pages.some(page => page.name === name) ? '' : ' (missing)'));
      option.value = name; $('backup-page').append(option);
    }
    $('backup-page').value = selectedName ?? ''; $('backup-page').disabled = busy || !names.length;
  }
  function render() {
    $('pages').replaceChildren(); pageButtons.clear();
    const pages = visiblePages(inventory?.pages ?? [], $('search').value, sortKey, sortDirection);
    const labels = { name: 'Filename', modified: 'Modified', size: 'Size' };
    for (const key of Object.keys(labels)) {
      const active = sortKey === key;
      $('heading-' + key).setAttribute('aria-sort', active ? sortDirection : 'none');
      const control = $('sort-' + key);
      control.textContent = labels[key];
      const indicator = node('span', active ? sortDirection === 'ascending' ? ' ↑' : ' ↓' : ' ↕');
      indicator.setAttribute('aria-hidden', 'true'); control.append(indicator);
      const next = active ? sortDirection === 'ascending' ? 'descending' : 'ascending' : key === 'name' ? 'ascending' : 'descending';
      control.setAttribute('aria-label', `${labels[key]}, sort ${next}`);
    }
    for (const page of pages) {
      const row = node('tr'), name = node('td'), cell = node('div'); cell.className = 'page-cell';
      row.className = page.name === selectedName ? 'selected' : '';
      const choose = button(page.name, () => { select(page.name); pageButtons.get(page.name)?.focus(); }); choose.className = 'page-select';
      row.addEventListener('click', event => { if (!event.target.closest('a, button')) choose.click(); });
      pageButtons.set(page.name, choose);
      choose.setAttribute('aria-pressed', String(page.name === selectedName));
      choose.setAttribute('aria-label', `Select ${page.name}`);
      cell.append(preview(page), choose); name.append(cell);
      const actions = node('td'), wrap = node('div'); wrap.className = 'actions';
      const link = node('a', 'Open'); link.href = pageUrl(inventory.origin, page.name, location.origin); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Open ${page.name} in a new tab`);
      const remove = button('Delete', trigger => review('delete', page.name, trigger), true); remove.className = 'danger';
      remove.setAttribute('aria-label', `Delete ${page.name}`);
      wrap.append(link, remove); actions.append(wrap);
      const modified = node('td'); modified.className = 'modified-cell';
      if (Number.isFinite(modifiedTime(page.modifiedAt))) {
        const time = node('time', new Date(page.modifiedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
        time.setAttribute('datetime', page.modifiedAt); time.title = date(page.modifiedAt);
        const clock = node('span', new Date(page.modifiedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }));
        clock.className = 'time-of-day'; time.append(clock); modified.append(time);
      } else modified.textContent = 'Unknown';
      const bytes = node('td', size(page.size)); bytes.className = 'size-cell';
      if (Number.isFinite(page.size)) bytes.title = `${page.size.toLocaleString()} bytes`;
      row.append(name, modified, bytes, actions); $('pages').append(row);
    }
    $('summary').textContent = inventory ? `${pages.length} of ${inventory.pages.length} HTML pages` : 'Inventory unavailable';
    const order = sortKey === 'modified' ? sortDirection === 'descending' ? 'newest first' : 'oldest first' :
      sortKey === 'size' ? sortDirection === 'descending' ? 'largest first' : 'smallest first' :
        sortDirection === 'ascending' ? 'A-Z' : 'Z-A';
    const unknownDates = pages.filter(page => !Number.isFinite(modifiedTime(page.modifiedAt))).length;
    $('view-status').textContent = `${labels[sortKey]}: ${order}.` +
      (sortKey === 'modified' && unknownDates ? ` ${unknownDates} unknown date${unknownDates === 1 ? '' : 's'} last.` : '') +
      (selectedName && !pages.some(page => page.name === selectedName) ? ' Selected page is not in this view; its details remain available.' : '');
    $('clear-search').hidden = !$('search').value;
    $('read-only').textContent = inventory && (!fresh || !inventory.mutationsEnabled) ?
      !fresh ? 'Displayed inventory is last-known only. Refresh before another change.' : 'Read-only. Hosted mutations are disabled pending approved activation.' : '';
    $('empty').textContent = inventory ? pages.length ? '' : 'No matching HTML pages.' : 'Inventory unavailable. Refresh before any action.';
    renderDetails();
  }
  async function loadInventory() {
    const result = await api('inventory');
    if (!Array.isArray(result.pages) || !Array.isArray(result.backups) || !result.missingVersions ||
        !result.access || !Array.isArray(result.access.allowedGroupIds) || result.origin !== location.origin) throw new Error('Invalid inventory response.');
    for (const version of [...result.pages, ...result.backups]) thumbnailUrl(version);
    inventory = result; fresh = true;
    if (!selectedName) selectedName = visiblePages(result.pages, '', sortKey, sortDirection)[0]?.name ?? result.backups[0]?.name ?? null;
    const current = result.pages.find(page => page.name === selectedName);
    if (current) lastKnown = current;
    fields($('policy'), [['Tenant', result.access.tenantId], ['Reader groups', result.access.allowedGroupIds.join(', ') || 'Unknown'],
      ['Authentication', result.access.authentication], ['Network', result.access.network]]);
  }
  async function refresh() {
    if (busy) return;
    fresh = false; setBusy(true); status('Checking manager identity, reader groups and server inventory.');
    try {
      await loadInventory();
      status('Inventory loaded. Review the exact file and version before each change.');
    } catch (error) {
      status(error instanceof ClientError ? error.message : 'Inventory could not be verified. Refresh before any action.', true);
    } finally { setBusy(false); }
  }
  $('refresh').addEventListener('click', refresh);
  $('search').addEventListener('input', render);
  $('clear-search').addEventListener('click', () => { $('search').value = ''; render(); $('search').focus(); });
  for (const key of ['name', 'modified', 'size']) $('sort-' + key).addEventListener('click', () => {
    sortDirection = sortKey === key ? sortDirection === 'ascending' ? 'descending' : 'ascending' :
      key === 'name' ? 'ascending' : 'descending';
    sortKey = key; render();
  });
  $('backup-page').addEventListener('change', () => select($('backup-page').value));
  function dismiss() {
    pending = null; $('confirmation').close();
    const focus = returnFocus?.isConnected ? returnFocus : $('backup-page');
    focus?.focus();
  }
  $('cancel').addEventListener('click', dismiss);
  $('confirmation').addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  $('confirm-name').addEventListener('input', () => { $('confirm').disabled = !pending || !canMutate() || $('confirm-name').value !== pending.name; });
  $('confirm').addEventListener('click', async () => {
    if (!pending || !canMutate() || $('confirm-name').value !== pending.name) return;
    const request = pending, expectedThumbnail = pendingThumbnail; dismiss(); setBusy(true); fresh = false;
    status('Applying the reviewed operation. Do not retry if the response is interrupted.');
    let result;
    try { result = await api('mutate', request); await verifyResult(request, result, expectedThumbnail); }
    catch (error) {
      status(error instanceof ClientError ? error.message : uncertainFailure().message, true);
      setBusy(false); return;
    }
    selectedBackupId = null;
    const message = `Verified ${result.action}: ${result.name}. Transaction ${result.transactionId}.` +
      (result.action === 'delete' ? '' : ` URL: ${pageUrl(location.origin, result.name, location.origin)}.`);
    try { await loadInventory(); status(message); }
    catch { status(message + ' Inventory refresh failed; displayed details are last-known. Refresh before another change.', true); }
    finally { setBusy(false); $('backup-page').focus(); }
  });
  refresh();
}
