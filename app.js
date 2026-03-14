/***  Sukupuu – Family Tree Application  ***/

(function () {
    'use strict';

    // ── State ──
    let xmlDoc = null;          // Parsed XML document
    let individuals = {};       // id -> person object
    let currentFileName = null; // Currently open file name
    let relations = [];         // raw relation list
    let selectedId = null;      // Currently selected person
    let treeRootId = null;      // Person at tree root
    let editingId = null;       // null = adding, id = editing
    let treeViewMode = 'normal'; // 'normal' or 'compact'
    let scale = 1;
    let panX = 0, panY = 0;
    let isPanning = false, panStartX = 0, panStartY = 0;

    // ── DOM refs ──
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const searchInput = $('#searchInput');
    const personList = $('#personList');
    const personCount = $('#personCount');
    const treeCanvas = $('#treeCanvas');
    const treeLines = $('#treeLines');
    const treeEmpty = $('#treeEmpty');
    const treeContainer = $('#treeContainer');
    const treeArea = $('#treeArea');
    const detailEmpty = $('#detailEmpty');
    const detailView = $('#detailView');
    const detailAvatar = $('#detailAvatar');
    const detailName = $('#detailName');
    const detailId = $('#detailId');
    const detailContent = $('#detailContent');
    const modalOverlay = $('#modalOverlay');
    // ── Init ──
    async function init() {
        bindEvents();

        const saved = localStorage.getItem('sukupuu_xml');
        const hasDraft = !!saved;

        if (hasDraft) {
            const useDraft = confirm('Sinulla on tallentamattomia muutoksia selaimessa.\n\nHaluatko ladata nämä muutokset (OK) vai olla lataamatta (Peruuta)?');
            if (useDraft) {
                loadXmlString(saved);
                updateFileName('Sukupuu (paikallinen luonnos)', '');
                showToast('Ladattu paikallinen luonnos');
                return;
            }
        }

        openFile();
    }

    // ── XML Parsing ──
    function loadXmlString(xmlText) {
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(xmlText, 'application/xml');
        parseData();
        renderPersonList();
        showToast('Sukupuu ladattu – ' + Object.keys(individuals).length + ' henkilöä');
    }

    function parseData() {
        individuals = {};
        relations = [];

        // Parse individuals
        const units = xmlDoc.querySelectorAll('units > unit[tag="INDI"]');
        units.forEach(unit => {
            const id = unit.getAttribute('unitid');
            const sex = unit.getAttribute('sex');
            const nameEl = unit.querySelector(':scope > name');
            const givenname = nameEl?.querySelector('givenname')?.textContent || '';
            const surname = nameEl?.querySelector('surname')?.textContent || '';

            const person = {
                id, sex, givenname, surname,
                displayName: formatDisplayName(givenname, surname),
                birthDate: null, birthPlace: null,
                deathDate: null, deathPlace: null,
                burialDate: null, burialPlace: null,
                occupations: [],
                education: null,
                marriedNames: [],
                notes: [],
                photos: [],
                createdate: unit.getAttribute('createdate'),
                // Relations (filled later)
                spouseIds: [],
                childIds: [],     // this person's children
                parentIds: [],    // this person's parents
                marriageInfo: {}  // spouseId -> { date, place }
            };

            // Parse notices
            const notices = unit.querySelectorAll('notices > notice');
            notices.forEach(notice => {
                const tag = notice.getAttribute('tag');
                switch (tag) {
                    case 'BIRT': {
                        const d = notice.querySelector('date > start');
                        const p = notice.querySelector('place');
                        person.birthDate = d?.textContent || null;
                        person.birthPlace = p?.textContent || null;
                        break;
                    }
                    case 'DEAT': {
                        const d = notice.querySelector('date > start');
                        const p = notice.querySelector('place');
                        person.deathDate = d?.textContent || null;
                        person.deathPlace = p?.textContent || null;
                        break;
                    }
                    case 'BURI': {
                        const d = notice.querySelector('date > start');
                        const p = notice.querySelector('place');
                        person.burialDate = d?.textContent || null;
                        person.burialPlace = p?.textContent || null;
                        break;
                    }
                    case 'OCCU': {
                        const desc = notice.querySelector('description');
                        if (desc?.textContent) {
                            desc.textContent.split(';').forEach(o => {
                                if (o.trim()) person.occupations.push(o.trim());
                            });
                        }
                        break;
                    }
                    case 'EDUC': {
                        const desc = notice.querySelector('description');
                        const p = notice.querySelector('place');
                        person.education = (desc?.textContent || '') + (p?.textContent ? ' (' + p.textContent + ')' : '');
                        break;
                    }
                    case 'NAME': {
                        const gn = notice.querySelector('name > givenname');
                        const sn = notice.querySelector('name > surname');
                        const desc = notice.querySelector('description');
                        if (sn?.textContent) {
                            person.marriedNames.push({
                                givenname: gn?.textContent || '',
                                surname: sn.textContent,
                                description: desc?.textContent || ''
                            });
                        }
                        break;
                    }
                    case 'NOTE': {
                        const nt = notice.querySelector('notetext');
                        if (nt?.textContent) person.notes.push(nt.textContent);
                        break;
                    }
                    case 'PHOT':
                    case 'PHOTO': {
                        const fn = notice.querySelector('media > mediafilename');
                        const tt = notice.querySelector('media > mediatitle');
                        if (fn?.textContent) {
                            person.photos.push({
                                filename: fn.textContent,
                                title: tt?.textContent || ''
                            });
                        }
                        break;
                    }
                }
            });

            individuals[id] = person;
        });

        // Parse relations
        const rels = xmlDoc.querySelectorAll('relations > relation');
        rels.forEach(rel => {
            const tag = rel.getAttribute('tag');
            const a = rel.getAttribute('unitida');
            const b = rel.getAttribute('unitidb');
            const dateEl = rel.querySelector('begindate > start');
            const placeEl = rel.querySelector('beginplace');
            relations.push({
                tag, a, b,
                date: dateEl?.textContent || null,
                place: placeEl?.textContent || null
            });

            if (tag === 'CHIL') {
                // a is child, b is parent
                if (individuals[a] && individuals[b]) {
                    if (!individuals[a].parentIds.includes(b)) individuals[a].parentIds.push(b);
                    if (!individuals[b].childIds.includes(a)) individuals[b].childIds.push(a);
                }
            } else if (tag === 'MARR') {
                if (individuals[a] && individuals[b]) {
                    if (!individuals[a].spouseIds.includes(b)) individuals[a].spouseIds.push(b);
                    if (!individuals[b].spouseIds.includes(a)) individuals[b].spouseIds.push(a);
                    const info = { date: dateEl?.textContent || null, place: placeEl?.textContent || null };
                    individuals[a].marriageInfo[b] = info;
                    individuals[b].marriageInfo[a] = info;
                }
            }
        });

        // Dedupe children lists (remove duplicate ids)
        Object.values(individuals).forEach(p => {
            p.childIds = [...new Set(p.childIds)];
            p.parentIds = [...new Set(p.parentIds)];
            p.spouseIds = [...new Set(p.spouseIds)];
        });
    }

    function formatDisplayName(givenname, surname) {
        // Extract call name (marked with *) for compact display
        let call = givenname.replace(/[*()]/g, '').trim().split(/\s+/)[0];
        // Find the name with *, that's the call name
        const match = givenname.match(/(\S*)\*/);
        if (match) {
            call = match[1] || givenname.split('*')[0].trim().split(/\s+/).pop();
        }
        return call + ' ' + surname;
    }

    function getFullName(p) {
        return (p.givenname + ' ' + p.surname).replace(/\*/g, '');
    }

    function formatDate(d) {
        if (!d) return '';
        d = d.toString();
        if (d.length === 8) {
            return d.substring(6, 8) + '.' + d.substring(4, 6) + '.' + d.substring(0, 4);
        }
        if (d.length === 4) return d;
        return d;
    }

    function getYearFromDate(d) {
        if (!d) return '';
        return d.toString().substring(0, 4);
    }

    function getLifeSpan(p) {
        const b = getYearFromDate(p.birthDate);
        const d = getYearFromDate(p.deathDate);
        if (b && d) return b + '–' + d;
        if (b) return 's. ' + b;
        return '';
    }

    function getInitials(p) {
        const parts = p.displayName.split(' ');
        return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    }

    // ── Person List ──
    function renderPersonList(filter = '') {
        const filt = filter.toLowerCase();
        const sorted = Object.values(individuals).sort((a, b) =>
            (a.surname + a.givenname).localeCompare(b.surname + b.givenname, 'fi')
        );

        const filtered = filt
            ? sorted.filter(p =>
                p.displayName.toLowerCase().includes(filt) ||
                getFullName(p).toLowerCase().includes(filt) ||
                p.marriedNames.some(mn => ((mn.givenname || '') + ' ' + mn.surname).replace(/\*/g, '').toLowerCase().includes(filt))
            )
            : sorted;

        personCount.textContent = filtered.length + ' henkilöä' + (filt ? ' (suodatettu)' : '');

        personList.innerHTML = '';
        filtered.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'person-item' + (p.id === selectedId ? ' active' : '');
            item.style.animationDelay = Math.min(i * 10, 300) + 'ms';
            item.innerHTML = `
        <div class="avatar ${p.sex === 'M' ? 'male' : 'female'}">${getInitials(p)}</div>
        <div class="info">
          <div class="name">${getFullName(p)}</div>
          <div class="dates">${getLifeSpan(p)}</div>
        </div>
      `;
            item.addEventListener('click', () => selectPerson(p.id));
            personList.appendChild(item);
        });
    }

    // ── Select Person ──
    function selectPerson(id) {
        selectedId = id;
        // Update list active state
        personList.querySelectorAll('.person-item').forEach((el, i) => {
            const sorted = Object.values(individuals).sort((a, b) =>
                (a.surname + a.givenname).localeCompare(b.surname + b.givenname, 'fi')
            );
            // Just re-render to update active
        });
        renderPersonList(searchInput.value);
        showDetail(id);
        showTree(id);
    }

    // ── Detail Panel ──
    function showDetail(id) {
        const p = individuals[id];
        if (!p) { detailEmpty.style.display = ''; detailView.style.display = 'none'; return; }
        detailEmpty.style.display = 'none';
        detailView.style.display = 'flex';

        detailAvatar.className = 'detail-avatar ' + (p.sex === 'M' ? 'male' : 'female');
        detailAvatar.textContent = getInitials(p);
        detailName.textContent = getFullName(p);
        detailId.textContent = p.id;

        let html = '';

        // Basic info
        html += '<div class="detail-section"><h3>Perustiedot</h3>';
        if (p.birthDate || p.birthPlace) {
            html += detailRow('Syntynyt', formatDate(p.birthDate) + (p.birthPlace ? ', ' + p.birthPlace : ''));
        }
        if (p.deathDate || p.deathPlace) {
            html += detailRow('Kuollut', formatDate(p.deathDate) + (p.deathPlace ? ', ' + p.deathPlace : ''));
        }
        if (p.burialDate || p.burialPlace) {
            html += detailRow('Haudattu', formatDate(p.burialDate) + (p.burialPlace ? ', ' + p.burialPlace : ''));
        }
        html += detailRow('Sukupuoli', p.sex === 'M' ? 'Mies' : 'Nainen');
        if (p.occupations.length) {
            html += detailRow('Ammatti', p.occupations.join(', '));
        }
        if (p.education) {
            html += detailRow('Koulutus', p.education);
        }
        html += '</div>';

        // Married names
        if (p.marriedNames.length) {
            html += '<div class="detail-section"><h3>Muut nimet</h3>';
            p.marriedNames.forEach(mn => {
                const desc = mn.description ? ' (' + mn.description + ')' : '';
                html += detailRow('', (mn.givenname ? mn.givenname.replace(/\*/g, '') + ' ' : '') + mn.surname + desc);
            });
            html += '</div>';
        }

        // Family
        html += '<div class="detail-section"><h3>Perhe</h3>';

        // Parents
        p.parentIds.forEach(pid => {
            const par = individuals[pid];
            if (par) {
                const role = par.sex === 'M' ? 'Isä' : 'Äiti';
                html += familyLink(par, role);
            }
        });

        // Spouses
        p.spouseIds.forEach(sid => {
            const sp = individuals[sid];
            if (sp) {
                const mi = p.marriageInfo[sid];
                let label = 'Puoliso';
                if (mi && mi.date) label += ' (' + formatDate(mi.date) + ')';
                html += familyLink(sp, label);
            }
        });

        // Children (sorted by birth year)
        const children = p.childIds
            .map(cid => individuals[cid])
            .filter(Boolean)
            .sort((a, b) => (a.birthDate || '').localeCompare(b.birthDate || ''));

        children.forEach(ch => {
            const role = ch.sex === 'M' ? 'Poika' : 'Tytär';
            html += familyLink(ch, role);
        });

        // Siblings
        const siblingIds = new Set();
        p.parentIds.forEach(pid => {
            const par = individuals[pid];
            if (par) {
                par.childIds.forEach(cid => {
                    if (cid !== id) siblingIds.add(cid);
                });
            }
        });
        [...siblingIds].forEach(sid => {
            const sib = individuals[sid];
            if (sib) {
                html += familyLink(sib, sib.sex === 'M' ? 'Veli' : 'Sisko');
            }
        });

        html += '</div>';

        // Notes
        if (p.notes.length) {
            html += '<div class="detail-section"><h3>Muistiinpanot</h3>';
            p.notes.forEach(n => {
                html += '<div style="font-size:13px;padding:6px 0;color:var(--text-secondary);">' + escapeHtml(n) + '</div>';
            });
            html += '</div>';
        }

        detailContent.innerHTML = html;

        // Bind family link clicks
        detailContent.querySelectorAll('.family-link').forEach(el => {
            el.addEventListener('click', () => {
                selectPerson(el.dataset.id);
            });
        });
    }

    function detailRow(label, value) {
        return `<div class="detail-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
    }

    function familyLink(p, relation) {
        return `<div class="family-link" data-id="${p.id}">
      <div class="mini-avatar ${p.sex === 'M' ? 'male' : 'female'}">${getInitials(p)}</div>
      <span class="link-name">${p.displayName}</span>
      <span class="link-relation">${relation}</span>
    </div>`;
    }

    // ── Tree Rendering ──
    const NODE_W = 200;
    const NODE_H = 65;
    const H_GAP = 30;
    const V_GAP = 60;

    // Compact view dimensions
    const COMPACT_NODE_W = 160;
    const COMPACT_NODE_H = 50;
    const COMPACT_H_GAP = 15;
    const COMPACT_V_GAP = 35;

    function showTree(rootId) {
        if (treeViewMode === 'compact') {
            showTreeCompact(rootId);
            return;
        }
        treeRootId = rootId;
        treeEmpty.style.display = 'none';

        // Build tree data: ancestors up, descendants down
        const nodes = [];
        const edges = [];
        const positions = {};

        // Collect ancestors (up to 4 generations)
        function collectAncestors(pid, gen, index) {
            const p = individuals[pid];
            if (!p || gen > 4) return;

            const key = pid + '_a' + gen;
            if (positions[key]) return;
            positions[key] = { gen, index };
            nodes.push({ id: pid, key, gen, index, person: p });

            const parents = p.parentIds.filter(id => individuals[id]);
            parents.forEach((parId, i) => {
                const childIndex = index * 2 + (i === 0 ? 0 : 1);
                collectAncestors(parId, gen - 1, childIndex);
                edges.push({ from: pid + '_a' + gen, to: parId + '_a' + (gen - 1), type: 'parent' });
            });
        }

        // Collect descendants (down)
        function collectDescendants(pid, gen, xoff) {
            const p = individuals[pid];
            if (!p || gen > 4) return { width: NODE_W + H_GAP };

            const key = pid + '_d' + gen;
            if (positions[key]) return { width: 0 };

            // Get children
            const children = p.childIds
                .map(cid => individuals[cid])
                .filter(Boolean)
                .sort((a, b) => (a.birthDate || '').localeCompare(b.birthDate || ''));

            // Also include spouse node to the right
            let totalWidth = NODE_W + H_GAP;
            let childWidths = [];
            let childKeys = [];

            if (children.length === 0) {
                positions[key] = { x: xoff, y: gen * (NODE_H + V_GAP), gen };
                nodes.push({ id: pid, key, person: p });
                return { width: totalWidth };
            }

            // Layout children first to get their total width
            let cx = xoff;
            children.forEach(ch => {
                const chKey = ch.id + '_d' + (gen + 1);
                const result = collectDescendants(ch.id, gen + 1, cx);
                childWidths.push(result.width);
                childKeys.push(chKey);
                cx += result.width;
            });

            totalWidth = Math.max(NODE_W + H_GAP, cx - xoff);

            // Center this node above its children
            const childrenSpan = cx - xoff - H_GAP;
            const myX = xoff + (childrenSpan - NODE_W) / 2;

            positions[key] = { x: Math.max(xoff, myX), y: gen * (NODE_H + V_GAP), gen };
            nodes.push({ id: pid, key, person: p });

            // Edges to children
            childKeys.forEach(ck => {
                edges.push({ from: key, to: ck, type: 'child' });
            });

            return { width: totalWidth };
        }

        // Build the tree: ancestors above, root at center, descendants below
        // Step 1: Build descendant tree from root
        const descResult = collectDescendants(rootId, 0, 0);

        // Step 2: Build ancestor tree
        // Layout ancestors in a binary-tree fashion above the root
        const rootPos = positions[rootId + '_d0'];
        const rootCx = rootPos ? rootPos.x + NODE_W / 2 : 400;

        function layoutAncestors(personId, gen, cx) {
            const p = individuals[personId];
            if (!p) return;
            const key = personId + '_a' + gen;

            // Skip if already placed as descendant (root would be)
            if (gen === 0) return; // Root already placed

            const spacing = Math.pow(2, Math.abs(gen) - 1) * (NODE_W + H_GAP);

            positions[key] = { x: cx - NODE_W / 2, y: gen * (NODE_H + V_GAP), gen };
            nodes.push({ id: personId, key, person: p });

            const parents = p.parentIds.filter(id => individuals[id]);
            if (parents.length >= 1) {
                const fatherOffset = parents.length > 1 ? -spacing / 2 : 0;
                layoutAncestors(parents[0], gen - 1, cx + fatherOffset);
                edges.push({ from: key, to: parents[0] + '_a' + (gen - 1), type: 'parent' });
            }
            if (parents.length >= 2) {
                layoutAncestors(parents[1], gen - 1, cx + spacing / 2);
                edges.push({ from: key, to: parents[1] + '_a' + (gen - 1), type: 'parent' });
            }
        }

        const rootPerson = individuals[rootId];
        if (rootPerson) {
            const parents = rootPerson.parentIds.filter(id => individuals[id]);
            if (parents.length >= 1) {
                const spacing = (NODE_W + H_GAP);
                const fatherCx = parents.length > 1 ? rootCx - spacing / 2 : rootCx;
                layoutAncestors(parents[0], -1, fatherCx);
                edges.push({ from: rootId + '_d0', to: parents[0] + '_a-1', type: 'parent' });
            }
            if (parents.length >= 2) {
                const spacing = (NODE_W + H_GAP);
                layoutAncestors(parents[1], -1, rootCx + spacing / 2);
                edges.push({ from: rootId + '_d0', to: parents[1] + '_a-1', type: 'parent' });
            }
        }

        // Add spouse nodes beside root
        if (rootPerson) {
            rootPerson.spouseIds.forEach((sid, i) => {
                const sp = individuals[sid];
                if (!sp) return;
                const key = sid + '_spouse';
                if (!positions[key]) {
                    const rootY = positions[rootId + '_d0']?.y || 0;
                    const rootX = positions[rootId + '_d0']?.x || 0;
                    positions[key] = {
                        x: rootX + NODE_W + H_GAP + (i * (NODE_W + H_GAP)),
                        y: rootY,
                        gen: 0
                    };
                    nodes.push({ id: sid, key, person: sp });
                    edges.push({ from: rootId + '_d0', to: key, type: 'marriage' });
                }
            });
        }

        // Normalize positions: shift everything so min y = 20, min x = 20
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        Object.values(positions).forEach(pos => {
            if (pos.x < minX) minX = pos.x;
            if (pos.y < minY) minY = pos.y;
            if (pos.x + NODE_W > maxX) maxX = pos.x + NODE_W;
            if (pos.y + NODE_H > maxY) maxY = pos.y + NODE_H;
        });

        const offsetX = -minX + 40;
        const offsetY = -minY + 40;

        Object.values(positions).forEach(pos => {
            pos.x += offsetX;
            pos.y += offsetY;
        });

        maxX += offsetX;
        maxY += offsetY;

        // Render nodes — keep SVG, remove old divs
        treeCanvas.querySelectorAll('.tree-node').forEach(n => n.remove());
        const uniqueNodes = new Map();
        nodes.forEach(n => {
            if (!uniqueNodes.has(n.key)) uniqueNodes.set(n.key, n);
        });

        uniqueNodes.forEach(n => {
            const pos = positions[n.key];
            if (!pos) return;
            const p = n.person;

            const div = document.createElement('div');
            div.className = 'tree-node ' + (p.sex === 'M' ? 'male' : 'female') + (n.id === rootId ? ' selected' : '');
            div.style.left = pos.x + 'px';
            div.style.top = pos.y + 'px';
            div.innerHTML = `
        <div class="node-name">${p.displayName}</div>
        <div class="node-dates">${getLifeSpan(p)}</div>
      `;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                selectPerson(n.id);
            });
            treeCanvas.appendChild(div);
        });

        // Render edges
        const svgW = maxX + 40;
        const svgH = maxY + 40;
        treeLines.setAttribute('width', svgW);
        treeLines.setAttribute('height', svgH);
        treeLines.style.width = svgW + 'px';
        treeLines.style.height = svgH + 'px';

        let pathsHtml = '';
        edges.forEach(e => {
            const fromPos = positions[e.from];
            const toPos = positions[e.to];
            if (!fromPos || !toPos) return;

            const fromCx = fromPos.x + NODE_W / 2;
            const toCx = toPos.x + NODE_W / 2;

            if (e.type === 'marriage') {
                // Horizontal dashed line between spouses
                const y = fromPos.y + NODE_H / 2;
                const x1 = fromPos.x + NODE_W;
                const x2 = toPos.x;
                pathsHtml += `<line class="marr-line" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />`;
            } else if (e.type === 'parent') {
                // Line from child (bottom of parent or top of child depending on direction)
                if (fromPos.y > toPos.y) {
                    // from is below to (from is child, to is parent above)
                    const fromTop = fromPos.y;
                    const toBottom = toPos.y + NODE_H;
                    const midY = (fromTop + toBottom) / 2;
                    pathsHtml += `<path d="M ${fromCx} ${fromTop} L ${fromCx} ${midY} L ${toCx} ${midY} L ${toCx} ${toBottom}" />`;
                } else {
                    const fromBottom = fromPos.y + NODE_H;
                    const toTop = toPos.y;
                    const midY = (fromBottom + toTop) / 2;
                    pathsHtml += `<path d="M ${fromCx} ${fromBottom} L ${fromCx} ${midY} L ${toCx} ${midY} L ${toCx} ${toTop}" />`;
                }
            } else {
                // child edge: from parent down to child
                const fromBottom = fromPos.y + NODE_H;
                const toTop = toPos.y;
                const midY = (fromBottom + toTop) / 2;
                pathsHtml += `<path d="M ${fromCx} ${fromBottom} L ${fromCx} ${midY} L ${toCx} ${midY} L ${toCx} ${toTop}" />`;
            }
        });
        treeLines.innerHTML = pathsHtml;

        // Set canvas size
        treeCanvas.style.width = svgW + 'px';
        treeCanvas.style.height = svgH + 'px';

        // Center view on root
        centerOnRoot();
    }

    // ── Compact Tree Rendering ──
    // Vertical/indented layout: children stack vertically, each generation indented right.
    function showTreeCompact(rootId) {
        treeRootId = rootId;
        treeEmpty.style.display = 'none';

        const nw = COMPACT_NODE_W;
        const nh = COMPACT_NODE_H;
        const rowGap = 8;         // vertical gap between stacked rows
        const indentX = 30;       // horizontal indent per generation
        const ancestorVGap = COMPACT_V_GAP;

        const nodes = [];
        const edges = [];
        const positions = {};

        // ── Descendants: vertical stacking with indentation ──
        // Returns the next available Y position after this subtree
        function collectDescendants(pid, gen, startY, baseX) {
            const p = individuals[pid];
            if (!p || gen > 4) return startY;

            const key = pid + '_d' + gen;
            if (positions[key]) return startY;

            const xPos = baseX + gen * (nw + indentX);

            positions[key] = { x: xPos, y: startY };
            nodes.push({ id: pid, key, person: p });

            const children = p.childIds
                .map(cid => individuals[cid])
                .filter(Boolean)
                .sort((a, b) => (a.birthDate || '').localeCompare(b.birthDate || ''));

            let currentY = startY + nh + rowGap;

            children.forEach(ch => {
                const chKey = ch.id + '_d' + (gen + 1);
                edges.push({ from: key, to: chKey, type: 'child' });
                currentY = collectDescendants(ch.id, gen + 1, currentY, baseX);
            });

            return currentY;
        }

        // Build descendant tree from root at generation 0
        const descEndY = collectDescendants(rootId, 0, 0, 0);

        // ── Ancestors: use a classic tree layout above the root ──
        const rootPos = positions[rootId + '_d0'];
        const rootCx = rootPos ? rootPos.x + nw / 2 : 400;
        const rootY = rootPos ? rootPos.y : 0;

        function layoutAncestors(personId, gen, cx) {
            const p = individuals[personId];
            if (!p) return;
            const key = personId + '_a' + gen;
            if (gen === 0) return;

            const spacing = Math.pow(2, Math.abs(gen) - 1) * (nw + COMPACT_H_GAP);
            const y = rootY + gen * (nh + ancestorVGap);

            positions[key] = { x: cx - nw / 2, y: y };
            nodes.push({ id: personId, key, person: p });

            const parents = p.parentIds.filter(id => individuals[id]);
            if (parents.length >= 1) {
                const fatherOffset = parents.length > 1 ? -spacing / 2 : 0;
                layoutAncestors(parents[0], gen - 1, cx + fatherOffset);
                edges.push({ from: key, to: parents[0] + '_a' + (gen - 1), type: 'parent' });
            }
            if (parents.length >= 2) {
                layoutAncestors(parents[1], gen - 1, cx + spacing / 2);
                edges.push({ from: key, to: parents[1] + '_a' + (gen - 1), type: 'parent' });
            }
        }

        const rootPerson = individuals[rootId];
        if (rootPerson) {
            const parents = rootPerson.parentIds.filter(id => individuals[id]);
            if (parents.length >= 1) {
                const spacing = (nw + COMPACT_H_GAP);
                const fatherCx = parents.length > 1 ? rootCx - spacing / 2 : rootCx;
                layoutAncestors(parents[0], -1, fatherCx);
                edges.push({ from: rootId + '_d0', to: parents[0] + '_a-1', type: 'parent' });
            }
            if (parents.length >= 2) {
                const spacing = (nw + COMPACT_H_GAP);
                layoutAncestors(parents[1], -1, rootCx + spacing / 2);
                edges.push({ from: rootId + '_d0', to: parents[1] + '_a-1', type: 'parent' });
            }
        }

        // ── Spouse node beside root ──
        if (rootPerson) {
            rootPerson.spouseIds.forEach((sid, i) => {
                const sp = individuals[sid];
                if (!sp) return;
                const key = sid + '_spouse';
                if (!positions[key]) {
                    positions[key] = {
                        x: rootPos.x + nw + COMPACT_H_GAP + (i * (nw + COMPACT_H_GAP)),
                        y: rootPos.y
                    };
                    nodes.push({ id: sid, key, person: sp });
                    edges.push({ from: rootId + '_d0', to: key, type: 'marriage' });
                }
            });
        }

        // ── Normalize positions ──
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        Object.values(positions).forEach(pos => {
            if (pos.x < minX) minX = pos.x;
            if (pos.y < minY) minY = pos.y;
            if (pos.x + nw > maxX) maxX = pos.x + nw;
            if (pos.y + nh > maxY) maxY = pos.y + nh;
        });

        const offsetX = -minX + 40;
        const offsetY = -minY + 40;

        Object.values(positions).forEach(pos => {
            pos.x += offsetX;
            pos.y += offsetY;
        });

        maxX += offsetX;
        maxY += offsetY;

        // ── Render nodes ──
        treeCanvas.querySelectorAll('.tree-node').forEach(n => n.remove());
        const uniqueNodes = new Map();
        nodes.forEach(n => {
            if (!uniqueNodes.has(n.key)) uniqueNodes.set(n.key, n);
        });

        uniqueNodes.forEach(n => {
            const pos = positions[n.key];
            if (!pos) return;
            const p = n.person;

            const div = document.createElement('div');
            div.className = 'tree-node compact ' + (p.sex === 'M' ? 'male' : 'female') + (n.id === rootId ? ' selected' : '');
            div.style.left = pos.x + 'px';
            div.style.top = pos.y + 'px';
            div.innerHTML = `
        <div class="node-name">${p.displayName}</div>
        <div class="node-dates">${getLifeSpan(p)}</div>
      `;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                selectPerson(n.id);
            });
            treeCanvas.appendChild(div);
        });

        // ── Render edges ──
        const svgW = maxX + 40;
        const svgH = maxY + 40;
        treeLines.setAttribute('width', svgW);
        treeLines.setAttribute('height', svgH);
        treeLines.style.width = svgW + 'px';
        treeLines.style.height = svgH + 'px';

        let pathsHtml = '';
        edges.forEach(e => {
            const fromPos = positions[e.from];
            const toPos = positions[e.to];
            if (!fromPos || !toPos) return;

            if (e.type === 'marriage') {
                // Horizontal dashed line between spouses
                const y = fromPos.y + nh / 2;
                const x1 = fromPos.x + nw;
                const x2 = toPos.x;
                pathsHtml += `<line class="marr-line" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />`;
            } else if (e.type === 'parent') {
                const fromCx = fromPos.x + nw / 2;
                const toCx = toPos.x + nw / 2;
                if (fromPos.y > toPos.y) {
                    const fromTop = fromPos.y;
                    const toBottom = toPos.y + nh;
                    const midY = (fromTop + toBottom) / 2;
                    pathsHtml += `<path d="M ${fromCx} ${fromTop} L ${fromCx} ${midY} L ${toCx} ${midY} L ${toCx} ${toBottom}" />`;
                } else {
                    const fromBottom = fromPos.y + nh;
                    const toTop = toPos.y;
                    const midY = (fromBottom + toTop) / 2;
                    pathsHtml += `<path d="M ${fromCx} ${fromBottom} L ${fromCx} ${midY} L ${toCx} ${midY} L ${toCx} ${toTop}" />`;
                }
            } else {
                // child edge: L-shaped connector for indented layout
                // Vertical line down from parent's left edge, then horizontal to child
                const parentLeft = fromPos.x + 10;
                const parentBottom = fromPos.y + nh;
                const childLeft = toPos.x;
                const childMidY = toPos.y + nh / 2;
                pathsHtml += `<path d="M ${parentLeft} ${parentBottom} L ${parentLeft} ${childMidY} L ${childLeft} ${childMidY}" />`;
            }
        });
        treeLines.innerHTML = pathsHtml;

        treeCanvas.style.width = svgW + 'px';
        treeCanvas.style.height = svgH + 'px';

        centerOnRoot();
    }

    function centerOnRoot() {
        const rootKey = treeRootId + '_d0';
        const areaW = treeArea.clientWidth;
        const areaH = treeArea.clientHeight;
        const nw = treeViewMode === 'compact' ? COMPACT_NODE_W : NODE_W;
        const nh = treeViewMode === 'compact' ? COMPACT_NODE_H : NODE_H;

        // Find root position among tree nodes
        const rootNode = treeCanvas.querySelector('.tree-node.selected');
        if (rootNode) {
            const rx = parseFloat(rootNode.style.left) + nw / 2;
            const ry = parseFloat(rootNode.style.top) + nh / 2;
            scale = 0.85;
            panX = areaW / 2 - rx * scale;
            panY = areaH / 2 - ry * scale;
        } else {
            scale = 0.85;
            panX = 40;
            panY = 40;
        }
        applyTransform();
    }

    function applyTransform() {
        treeCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        zoomLevel.textContent = Math.round(scale * 100) + '%';
    }

    // ── Pan & Zoom ──
    function initPanZoom() {
        treeContainer.addEventListener('mousedown', e => {
            if (e.target.closest('.tree-node')) return;
            isPanning = true;
            panStartX = e.clientX - panX;
            panStartY = e.clientY - panY;
            treeContainer.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', e => {
            if (!isPanning) return;
            panX = e.clientX - panStartX;
            panY = e.clientY - panStartY;
            applyTransform();
        });

        window.addEventListener('mouseup', () => {
            isPanning = false;
            treeContainer.style.cursor = 'grab';
        });

        treeContainer.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.08 : 0.08;
            const newScale = Math.max(0.2, Math.min(3, scale + delta));

            // Zoom toward mouse position
            const rect = treeArea.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            panX = mx - (mx - panX) * (newScale / scale);
            panY = my - (my - panY) * (newScale / scale);
            scale = newScale;
            applyTransform();
        }, { passive: false });

        $('#btnZoomIn').addEventListener('click', () => { scale = Math.min(3, scale + 0.15); applyTransform(); });
        $('#btnZoomOut').addEventListener('click', () => { scale = Math.max(0.2, scale - 0.15); applyTransform(); });
        $('#btnZoomFit').addEventListener('click', () => centerOnRoot());
    }

    // ── Searchable Select Component ──
    const searchSelects = {}; // id -> { value, el }

    function initSearchableSelect(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const sexFilter = container.dataset.filter; // 'M', 'F', or ''

        container.innerHTML = `
            <input type="text" class="ss-input" placeholder="Hae nimellä..." autocomplete="off">
            <button type="button" class="ss-clear">✕</button>
            <div class="ss-dropdown"></div>
        `;

        const input = container.querySelector('.ss-input');
        const clearBtn = container.querySelector('.ss-clear');
        const dropdown = container.querySelector('.ss-dropdown');

        searchSelects[containerId] = { value: '', el: container, input, dropdown };

        function renderOptions(filter) {
            const filt = (filter || '').toLowerCase();
            const sorted = Object.values(individuals).sort((a, b) =>
                (a.surname + a.givenname).localeCompare(b.surname + b.givenname, 'fi')
            );
            const filtered = sorted.filter(p => {
                if (sexFilter && p.sex !== sexFilter) return false;
                if (filt) {
                    return (p.givenname + ' ' + p.surname).toLowerCase().includes(filt) ||
                        p.displayName.toLowerCase().includes(filt);
                }
                return true;
            });

            if (filtered.length === 0) {
                dropdown.innerHTML = '<div class="ss-empty">Ei tuloksia</div>';
                return;
            }

            // Limit to 50 for performance
            const shown = filtered.slice(0, 50);
            dropdown.innerHTML = shown.map(p => `
                <div class="ss-option" data-id="${p.id}">
                    <span class="ss-dot ${p.sex === 'M' ? 'male' : 'female'}"></span>
                    <span class="ss-name">${getFullName(p)}</span>
                    <span class="ss-meta">${getLifeSpan(p)}</span>
                </div>
            `).join('');

            if (filtered.length > 50) {
                dropdown.innerHTML += '<div class="ss-empty">...ja ' + (filtered.length - 50) + ' muuta. Tarkenna hakua.</div>';
            }

            // Highlight active
            const current = searchSelects[containerId].value;
            if (current) {
                const active = dropdown.querySelector(`[data-id="${current}"]`);
                if (active) active.classList.add('active');
            }

            // Bind clicks
            dropdown.querySelectorAll('.ss-option').forEach(opt => {
                opt.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const pid = opt.dataset.id;
                    const p = individuals[pid];
                    selectSearchable(containerId, pid, getFullName(p));
                });
            });
        }

        input.addEventListener('focus', () => {
            renderOptions(searchSelects[containerId].value ? '' : input.value);
            dropdown.classList.add('open');
        });

        input.addEventListener('input', () => {
            searchSelects[containerId].value = '';
            container.classList.remove('has-value');
            renderOptions(input.value);
            dropdown.classList.add('open');
        });

        input.addEventListener('blur', () => {
            setTimeout(() => dropdown.classList.remove('open'), 150);
        });

        clearBtn.addEventListener('click', () => {
            searchSelects[containerId].value = '';
            input.value = '';
            container.classList.remove('has-value');
            input.focus();
        });
    }

    function selectSearchable(containerId, id, displayText) {
        const ss = searchSelects[containerId];
        ss.value = id;
        ss.input.value = displayText;
        ss.el.classList.add('has-value');
        ss.dropdown.classList.remove('open');
    }

    function getSearchableValue(containerId) {
        return searchSelects[containerId]?.value || '';
    }

    function setSearchableValue(containerId, id) {
        const ss = searchSelects[containerId];
        if (!ss) return;
        if (id && individuals[id]) {
            ss.value = id;
            ss.input.value = getFullName(individuals[id]);
            ss.el.classList.add('has-value');
        } else {
            ss.value = '';
            ss.input.value = '';
            ss.el.classList.remove('has-value');
        }
    }

    // ── Modal (Add/Edit) ──
    function openModal(id = null) {
        editingId = id;
        const isEdit = !!id;
        $('#modalTitle').textContent = isEdit ? 'Muokkaa henkilöä' : 'Lisää henkilö';

        // Init searchable selects
        initSearchableSelect('selFather');
        initSearchableSelect('selMother');
        initSearchableSelect('selSpouse');

        if (isEdit) {
            const p = individuals[id];
            $('#formGivenname').value = p.givenname;
            $('#formSurname').value = p.surname;
            $('#formSex').value = p.sex;
            $('#formBirthDate').value = p.birthDate || '';
            $('#formBirthPlace').value = p.birthPlace || '';
            $('#formDeathDate').value = p.deathDate || '';
            $('#formDeathPlace').value = p.deathPlace || '';
            $('#formOccu').value = p.occupations.join(';');
            $('#formEduc').value = p.education || '';
            $('#formMarriedNames').value = p.marriedNames.map(mn => {
                const name = (mn.givenname ? mn.givenname.replace(/\*/g, '') + ' ' : '') + mn.surname;
                return mn.description ? name + ' (' + mn.description + ')' : name;
            }).join('; ');
            $('#formNote').value = p.notes.join('\n');

            // Set parents
            const father = p.parentIds.find(pid => individuals[pid]?.sex === 'M');
            const mother = p.parentIds.find(pid => individuals[pid]?.sex === 'F');
            setSearchableValue('selFather', father || '');
            setSearchableValue('selMother', mother || '');
            setSearchableValue('selSpouse', p.spouseIds[0] || '');
        } else {
            $$('.modal input, .modal textarea').forEach(el => el.value = '');
            $('#formSex').value = 'M';
            setSearchableValue('selFather', '');
            setSearchableValue('selMother', '');
            setSearchableValue('selSpouse', '');
        }

        modalOverlay.classList.add('active');
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
        editingId = null;
    }

    function saveModal() {
        const givenname = $('#formGivenname').value.trim();
        const surname = $('#formSurname').value.trim();
        if (!givenname || !surname) {
            alert('Etunimi ja sukunimi ovat pakollisia!');
            return;
        }

        const sex = $('#formSex').value;
        const birthDate = $('#formBirthDate').value.trim();
        const birthPlace = $('#formBirthPlace').value.trim();
        const deathDate = $('#formDeathDate').value.trim();
        const deathPlace = $('#formDeathPlace').value.trim();
        const occu = $('#formOccu').value.trim();
        const educ = $('#formEduc').value.trim();
        const marriedNamesStr = $('#formMarriedNames').value.trim();
        const note = $('#formNote').value.trim();
        const fatherId = getSearchableValue('selFather');
        const motherId = getSearchableValue('selMother');
        const spouseId = getSearchableValue('selSpouse');

        // Parse married names: "Etunimi Sukunimi (kuvaus); ..."
        const marriedNames = marriedNamesStr ? marriedNamesStr.split(';').map(s => {
            s = s.trim();
            if (!s) return null;
            let description = '';
            const parenMatch = s.match(/\(([^)]+)\)/);
            if (parenMatch) {
                description = parenMatch[1].trim();
                s = s.replace(/\([^)]+\)/, '').trim();
            }
            const parts = s.split(/\s+/);
            const surname = parts.pop() || '';
            const givenname = parts.join(' ');
            return { givenname, surname, description };
        }).filter(Boolean) : [];

        const isEdit = !!editingId;
        let id = editingId;

        if (!isEdit) {
            // Generate new ID
            let maxNum = 0;
            Object.keys(individuals).forEach(k => {
                const n = parseInt(k.substring(1));
                if (n > maxNum) maxNum = n;
            });
            id = 'I' + (maxNum + 1);
        }

        // Update or create XML unit
        if (isEdit) {
            updateXmlUnit(id, { givenname, surname, sex, birthDate, birthPlace, deathDate, deathPlace, occu, educ, marriedNames, note });
        } else {
            createXmlUnit(id, { givenname, surname, sex, birthDate, birthPlace, deathDate, deathPlace, occu, educ, marriedNames, note });
        }

        // Update relations
        updateRelations(id, fatherId, motherId, spouseId, isEdit);

        // Re-parse and refresh
        parseData();
        renderPersonList(searchInput.value);
        selectPerson(id);
        closeModal();

        showToast(isEdit ? 'Henkilö päivitetty' : 'Henkilö lisätty');
    }

    function createXmlUnit(id, data) {
        const units = xmlDoc.querySelector('units');
        const today = new Date().toISOString().split('T')[0];

        const unit = xmlDoc.createElement('unit');
        unit.setAttribute('unitid', id);
        unit.setAttribute('tag', 'INDI');
        unit.setAttribute('sex', data.sex);
        unit.setAttribute('createdate', today);

        const nameEl = xmlDoc.createElement('name');
        const gn = xmlDoc.createElement('givenname');
        gn.textContent = data.givenname;
        const sn = xmlDoc.createElement('surname');
        sn.textContent = data.surname;
        nameEl.appendChild(gn);
        nameEl.appendChild(sn);
        unit.appendChild(nameEl);

        const notices = xmlDoc.createElement('notices');
        let row = 1;

        if (data.birthDate || data.birthPlace) {
            notices.appendChild(createNotice('BIRT', row++, today, data.birthDate, data.birthPlace));
        }
        if (data.deathDate || data.deathPlace) {
            notices.appendChild(createNotice('DEAT', row++, today, data.deathDate, data.deathPlace));
        }
        if (data.occu) {
            const n = xmlDoc.createElement('notice');
            n.setAttribute('tag', 'OCCU');
            n.setAttribute('row', row++);
            n.setAttribute('createdate', today);
            const desc = xmlDoc.createElement('description');
            desc.textContent = data.occu;
            n.appendChild(desc);
            const nm = xmlDoc.createElement('name');
            n.appendChild(nm);
            notices.appendChild(n);
        }
        if (data.educ) {
            const n = xmlDoc.createElement('notice');
            n.setAttribute('tag', 'EDUC');
            n.setAttribute('row', row++);
            n.setAttribute('createdate', today);
            const desc = xmlDoc.createElement('description');
            desc.textContent = data.educ;
            n.appendChild(desc);
            const nm = xmlDoc.createElement('name');
            n.appendChild(nm);
            notices.appendChild(n);
        }
        if (data.marriedNames && data.marriedNames.length) {
            data.marriedNames.forEach(mn => {
                const n = xmlDoc.createElement('notice');
                n.setAttribute('tag', 'NAME');
                n.setAttribute('row', row++);
                n.setAttribute('createdate', today);
                if (mn.description) {
                    const desc = xmlDoc.createElement('description');
                    desc.textContent = mn.description;
                    n.appendChild(desc);
                }
                const nm = xmlDoc.createElement('name');
                const gn = xmlDoc.createElement('givenname');
                gn.textContent = mn.givenname;
                const sn = xmlDoc.createElement('surname');
                sn.textContent = mn.surname;
                nm.appendChild(gn);
                nm.appendChild(sn);
                n.appendChild(nm);
                notices.appendChild(n);
            });
        }
        if (data.note) {
            const n = xmlDoc.createElement('notice');
            n.setAttribute('tag', 'NOTE');
            n.setAttribute('row', row++);
            n.setAttribute('createdate', today);
            const nt = xmlDoc.createElement('notetext');
            nt.textContent = data.note;
            n.appendChild(nt);
            const nm = xmlDoc.createElement('name');
            n.appendChild(nm);
            notices.appendChild(n);
        }

        unit.appendChild(notices);
        units.appendChild(unit);
    }

    function updateXmlUnit(id, data) {
        const unit = xmlDoc.querySelector(`unit[unitid="${id}"]`);
        if (!unit) return;

        unit.setAttribute('sex', data.sex);

        // Update name
        const gn = unit.querySelector(':scope > name > givenname');
        const sn = unit.querySelector(':scope > name > surname');
        if (gn) gn.textContent = data.givenname;
        if (sn) sn.textContent = data.surname;

        // Update BIRT
        updateOrCreateNotice(unit, 'BIRT', data.birthDate, data.birthPlace);
        // Update DEAT
        if (data.deathDate || data.deathPlace) {
            updateOrCreateNotice(unit, 'DEAT', data.deathDate, data.deathPlace);
        }

        // Update OCCU
        const occuNotice = unit.querySelector('notice[tag="OCCU"]');
        if (data.occu) {
            if (occuNotice) {
                let desc = occuNotice.querySelector('description');
                if (!desc) { desc = xmlDoc.createElement('description'); occuNotice.appendChild(desc); }
                desc.textContent = data.occu;
            } else {
                const notices = unit.querySelector('notices') || (() => { const n = xmlDoc.createElement('notices'); unit.appendChild(n); return n; })();
                const n = xmlDoc.createElement('notice');
                n.setAttribute('tag', 'OCCU');
                n.setAttribute('row', '99');
                n.setAttribute('createdate', new Date().toISOString().split('T')[0]);
                const desc = xmlDoc.createElement('description');
                desc.textContent = data.occu;
                n.appendChild(desc);
                const nm = xmlDoc.createElement('name');
                n.appendChild(nm);
                notices.appendChild(n);
            }
        }

        // Update NAME notices (married/other names)
        const existingNameNotices = unit.querySelectorAll('notice[tag="NAME"]');
        existingNameNotices.forEach(n => n.remove());
        if (data.marriedNames && data.marriedNames.length) {
            const notices = unit.querySelector('notices') || (() => { const n = xmlDoc.createElement('notices'); unit.appendChild(n); return n; })();
            const today = new Date().toISOString().split('T')[0];
            data.marriedNames.forEach(mn => {
                const n = xmlDoc.createElement('notice');
                n.setAttribute('tag', 'NAME');
                n.setAttribute('row', '99');
                n.setAttribute('createdate', today);
                if (mn.description) {
                    const desc = xmlDoc.createElement('description');
                    desc.textContent = mn.description;
                    n.appendChild(desc);
                }
                const nm = xmlDoc.createElement('name');
                const gn = xmlDoc.createElement('givenname');
                gn.textContent = mn.givenname;
                const sn = xmlDoc.createElement('surname');
                sn.textContent = mn.surname;
                nm.appendChild(gn);
                nm.appendChild(sn);
                n.appendChild(nm);
                notices.appendChild(n);
            });
        }
    }

    function createNotice(tag, row, createdate, dateVal, placeVal) {
        const n = xmlDoc.createElement('notice');
        n.setAttribute('tag', tag);
        n.setAttribute('row', row);
        n.setAttribute('createdate', createdate);
        if (dateVal) {
            const d = xmlDoc.createElement('date');
            const s = xmlDoc.createElement('start');
            s.textContent = dateVal;
            d.appendChild(s);
            n.appendChild(d);
        }
        if (placeVal) {
            const p = xmlDoc.createElement('place');
            p.textContent = placeVal;
            n.appendChild(p);
        }
        const nm = xmlDoc.createElement('name');
        n.appendChild(nm);
        return n;
    }

    function updateOrCreateNotice(unit, tag, dateVal, placeVal) {
        let notice = unit.querySelector(`notice[tag="${tag}"]`);
        if (!notice) {
            const notices = unit.querySelector('notices') || (() => { const n = xmlDoc.createElement('notices'); unit.appendChild(n); return n; })();
            notice = xmlDoc.createElement('notice');
            notice.setAttribute('tag', tag);
            notice.setAttribute('row', '99');
            notice.setAttribute('createdate', new Date().toISOString().split('T')[0]);
            const nm = xmlDoc.createElement('name');
            notice.appendChild(nm);
            notices.appendChild(notice);
        }
        // Set date
        let dateEl = notice.querySelector('date');
        if (dateVal) {
            if (!dateEl) { dateEl = xmlDoc.createElement('date'); notice.insertBefore(dateEl, notice.firstChild); }
            let startEl = dateEl.querySelector('start');
            if (!startEl) { startEl = xmlDoc.createElement('start'); dateEl.appendChild(startEl); }
            startEl.textContent = dateVal;
        }
        // Set place
        let placeEl = notice.querySelector('place');
        if (placeVal) {
            if (!placeEl) { placeEl = xmlDoc.createElement('place'); notice.appendChild(placeEl); }
            placeEl.textContent = placeVal;
        }
    }

    function updateRelations(id, fatherId, motherId, spouseId, isEdit) {
        const relEl = xmlDoc.querySelector('relations');
        const today = new Date().toISOString().split('T')[0];

        if (isEdit) {
            // Remove existing parent relations for this person
            const existingRels = relEl.querySelectorAll('relation');
            existingRels.forEach(r => {
                if (r.getAttribute('tag') === 'CHIL' && r.getAttribute('unitida') === id) {
                    relEl.removeChild(r);
                }
                // Remove old marriage if changing spouse
                if (r.getAttribute('tag') === 'MARR') {
                    if (r.getAttribute('unitida') === id || r.getAttribute('unitidb') === id) {
                        relEl.removeChild(r);
                    }
                }
            });
        }

        // Add parent relations
        if (fatherId) {
            const r = xmlDoc.createElement('relation');
            r.setAttribute('unitida', id);
            r.setAttribute('unitidb', fatherId);
            r.setAttribute('tag', 'CHIL');
            r.setAttribute('rowa', '1');
            r.setAttribute('rowb', '1');
            r.setAttribute('createdate', today);
            relEl.appendChild(r);
        }
        if (motherId) {
            const r = xmlDoc.createElement('relation');
            r.setAttribute('unitida', id);
            r.setAttribute('unitidb', motherId);
            r.setAttribute('tag', 'CHIL');
            r.setAttribute('rowa', '2');
            r.setAttribute('rowb', '1');
            r.setAttribute('createdate', today);
            relEl.appendChild(r);
        }
        if (spouseId) {
            const r = xmlDoc.createElement('relation');
            r.setAttribute('unitida', id);
            r.setAttribute('unitidb', spouseId);
            r.setAttribute('tag', 'MARR');
            r.setAttribute('rowa', '1');
            r.setAttribute('rowb', '1');
            r.setAttribute('createdate', today);
            relEl.appendChild(r);
        }
    }

    // ── File Name Display ──
    function updateFileName(name, path) {
        currentFileName = name;
        if (currentFileEl) {
            currentFileEl.textContent = name || 'Ei tiedostoa auki';
            currentFileEl.title = path || 'Ei tiedostoa auki';
        }
    }

    // ── Open File ──
    async function openFile() {
        // Browser file picker
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xml';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                loadXmlString(evt.target.result);
                updateFileName(file.name, '');
            };
            reader.readAsText(file, 'UTF-8');
        };
        input.click();
    }

    // ── Save XML ──
    async function saveXml() {
        if (!xmlDoc) { alert('Ei ladattua tiedostoa!'); return; }
        const serializer = new XMLSerializer();
        let xmlStr = serializer.serializeToString(xmlDoc);
        if (!xmlStr.startsWith('<?xml')) {
            xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlStr;
        }

        try {
            localStorage.setItem('sukupuu_xml', xmlStr);
            showToast('Luonnos tallennettu selaimen muistiin');
        } catch (e) {
            alert('Tallennusvirhe: selaimen muisti täynnä. Käytä "Vie kopio" ladataksesi tiedoston.');
        }
    }

    // ── Export XML (Download Copy) ──
    async function exportXml() {
        if (!xmlDoc) { alert('Ei ladattua tiedostoa!'); return; }
        const serializer = new XMLSerializer();
        let xmlStr = serializer.serializeToString(xmlDoc);
        if (!xmlStr.startsWith('<?xml')) {
            xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlStr;
        }

        // Browser download
        const blob = new Blob([xmlStr], { type: 'application/xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFileName ? currentFileName : 'sukupuu_vienti.xml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Clear the local draft since it has been exported
        localStorage.removeItem('sukupuu_xml');

        showToast('Tiedosto ladattu onnistuneesti.');
    }

    // ── Toast ──
    function showToast(text) {
        const toast = $('#toast');
        const toastText = $('#toastText');
        toastText.textContent = text;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ── Delete Person ──
    function deletePerson(id) {
        const p = individuals[id];
        if (!p) return;

        const fullName = getFullName(p);
        if (!confirm(`Haluatko varmasti poistaa henkilön "${fullName}"?\n\nTämä poistaa myös kaikki henkilön suhteet.`)) {
            return;
        }

        // Remove the unit element from XML
        const unit = xmlDoc.querySelector(`unit[unitid="${id}"]`);
        if (unit) unit.remove();

        // Remove all relations referencing this person
        const rels = xmlDoc.querySelectorAll('relations > relation');
        rels.forEach(rel => {
            const a = rel.getAttribute('unitida');
            const b = rel.getAttribute('unitidb');
            if (a === id || b === id) {
                rel.remove();
            }
        });

        // Clear selection and re-parse
        selectedId = null;
        treeRootId = null;
        parseData();
        renderPersonList(searchInput.value);

        // Clear detail panel
        detailName.textContent = '';
        detailId.textContent = '';
        detailContent.innerHTML = '';

        // Clear tree
        treeCanvas.querySelectorAll('.tree-node').forEach(n => n.remove());
        treeLines.innerHTML = '';
        treeEmpty.style.display = 'flex';

        showToast(`"${fullName}" poistettu`);
    }

    // ── Utility ──
    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Events ──
    function bindEvents() {
        searchInput.addEventListener('input', () => {
            renderPersonList(searchInput.value);
        });

        $('#btnAddPerson').addEventListener('click', () => openModal());
        $('#btnEditPerson').addEventListener('click', () => {
            if (selectedId) openModal(selectedId);
        });
        $('#btnShowTree').addEventListener('click', () => {
            if (selectedId) showTree(selectedId);
        });
        $('#btnDeletePerson').addEventListener('click', () => {
            if (selectedId) deletePerson(selectedId);
        });

        // View toggle
        $('#btnViewNormal').addEventListener('click', () => {
            treeViewMode = 'normal';
            $('#btnViewNormal').classList.add('btn-active-view');
            $('#btnViewCompact').classList.remove('btn-active-view');
            if (treeRootId) showTree(treeRootId);
        });
        $('#btnViewCompact').addEventListener('click', () => {
            treeViewMode = 'compact';
            $('#btnViewCompact').classList.add('btn-active-view');
            $('#btnViewNormal').classList.remove('btn-active-view');
            if (treeRootId) showTree(treeRootId);
        });

        $('#btnOpenFile').addEventListener('click', openFile);
        $('#btnSaveXml').addEventListener('click', saveXml);
        $('#btnExportXml').addEventListener('click', exportXml);

        $('#modalClose').addEventListener('click', closeModal);
        $('#btnModalCancel').addEventListener('click', closeModal);
        $('#btnModalSave').addEventListener('click', saveModal);

        modalOverlay.addEventListener('click', e => {
            if (e.target === modalOverlay) closeModal();
        });

        initPanZoom();
    }

    // ── Bootstrap ──
    init();
})();
