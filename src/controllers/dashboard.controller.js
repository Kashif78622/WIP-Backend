// src/controllers/dashboard.controller.js

const prisma = require('../config/database');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// ==================== GET STATS ====================
const getStats = async (req, res, next) => {
    try {
        const [
            totalUsers,
            activeUsers,
            totalAreas,
            totalStages,
            totalMachines,
            activeMachines,
            totalBatches,
            activeBatches,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { isActive: true } }),
            prisma.area.count(),
            prisma.stage.count(),
            prisma.machine.count(),
            prisma.machine.count({ where: { isActive: true } }),
            prisma.batch.count(),
            prisma.batch.count({
                where: {
                    status: {
                        in: ['CREATED', 'IN_PROGRESS', 'ON_HOLD']
                    }
                }
            }),
        ]);

        res.json({
            success: true,
            data: {
                totalUsers,
                activeUsers,
                totalAreas,
                totalStages,
                totalMachines,
                activeMachines,
                totalBatches,
                activeBatches,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ==================== GET RECENT ACTIVITIES ====================
const getRecentActivities = async (req, res, next) => {
    try {
        const activities = await prisma.auditLog.findMany({
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: { name: true },
                },
            },
        });

        const formattedActivities = activities.map(activity => ({
            id: activity.id,
            action: activity.action,
            user: activity.user?.name || 'System',
            time: 'Just now',
            type: activity.entity.toLowerCase(),
            timestamp: activity.createdAt,
        }));

        res.json({
            success: true,
            data: formattedActivities,
        });
    } catch (error) {
        next(error);
    }
};

// ==================== SHARED COLORS ====================
const COLORS = {
    primary: '#187980',
    primaryDark: '#0f5f65',
    primaryLight: '#4a9a9a',
    text: '#14302c',
    textDim: '#3a5f5a',
    textMute: '#5f827c',
    border: '#c8ddd8',
    white: '#ffffff',
    zebra: '#f4f8f7',
    success: '#2e7d32',
    warning: '#ed6c02',
    danger: '#d32f2f',
    info: '#0288d1',
};

const STATUS_COLORS = {
    COMPLETED: COLORS.success,
    RUNNING: COLORS.success,
    IN_PROGRESS: COLORS.info,
    CREATED: COLORS.info,
    IDLE: COLORS.info,
    ON_HOLD: COLORS.warning,
    CLEANING: COLORS.warning,
    CANCELLED: COLORS.danger,
    DOWN: COLORS.danger,
};

const ROLE_COLORS = {
    ADMIN: '#d32f2f',
    MANAGER: '#ed6c02',
    SUPERVISOR: '#0288d1',
    OPERATOR: '#2e7d32',
    VIEWER: '#5f827c',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');
const fmtDateShort = (d) => (d ? new Date(d).toLocaleDateString() : '—');

// ==================== PDF TABLE HELPER WITH AUTO ROW HEIGHT ====================
function drawTable(doc, { x, columns, rows, startY, headerFill = COLORS.primary }) {
    const pageBottom = doc.page.height - 70;
    let y = startY;
    const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

    // Calculate row height based on content
    const calculateRowHeight = (row) => {
        let maxHeight = 18; // Minimum height
        columns.forEach((col) => {
            const value = String(row[col.key] ?? '—');
            // Estimate text height: approximately 10px per line of text
            const textWidth = col.width - 12;
            const lines = Math.ceil(doc.widthOfString(value, { width: textWidth }) / textWidth) || 1;
            const textHeight = Math.max(16, lines * 12);
            if (textHeight > maxHeight) maxHeight = textHeight;
        });
        return maxHeight + 8; // Add padding
    };

    // Ensure we have enough space for header + at least 1 row
    if (y + 40 > pageBottom) {
        doc.addPage();
        y = 50;
    }

    const drawHeader = () => {
        // Header background
        doc.rect(x, y, tableWidth, 22).fill(headerFill);

        // Header border
        doc.rect(x, y, tableWidth, 22).stroke(COLORS.border);

        let colX = x;
        columns.forEach((col) => {
            doc.fillColor(COLORS.white)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text(col.label, colX + 6, y + 6, {
                    width: col.width - 10,
                    ellipsis: true,
                    lineBreak: false
                });
            colX += col.width;
        });
        y += 22;
    };

    drawHeader();

    // If no rows, just return after header
    if (!rows || rows.length === 0) {
        doc.rect(x, startY, tableWidth, y - startY).stroke(COLORS.border);
        return y;
    }

    rows.forEach((row, index) => {
        const rowHeight = calculateRowHeight(row);

        // Check if we need a new page
        if (y + rowHeight > pageBottom) {
            doc.addPage();
            y = 50;
            drawHeader();
        }

        // Row background (zebra striping)
        if (index % 2 === 1) {
            doc.rect(x, y, tableWidth, rowHeight).fill(COLORS.zebra);
        } else {
            doc.rect(x, y, tableWidth, rowHeight).fill(COLORS.white);
        }

        // Row content with auto height
        let colX = x;
        columns.forEach((col) => {
            let value = row[col.key] ?? '—';
            const cellColor = col.colorKey ? (row[col.colorKey] || COLORS.text) : COLORS.text;
            const displayText = String(value);

            // Calculate text position with vertical centering
            const textWidth = col.width - 12;
            const textHeight = doc.heightOfString(displayText, { width: textWidth });
            const textY = y + (rowHeight - Math.min(textHeight, rowHeight - 4)) / 2;

            doc.fillColor(cellColor)
                .fontSize(8.5)
                .font('Helvetica')
                .text(displayText, colX + 6, textY, {
                    width: textWidth,
                    align: 'left',
                    lineBreak: true,
                    ellipsis: false
                });
            colX += col.width;
        });

        // Row border
        doc.rect(x, y, tableWidth, rowHeight).stroke(COLORS.border);
        y += rowHeight;
    });

    // Final bottom border
    doc.rect(x, startY, tableWidth, y - startY).stroke(COLORS.border);

    return y;
}

// ==================== NUMBERED SECTION HEADING ====================
let sectionCounter = 0;

function resetSectionCounter() {
    sectionCounter = 0;
}

function sectionHeading(doc, text, x, y) {
    sectionCounter++;
    const headingText = `${sectionCounter}. ${text}`;

    // Accent bar
    doc.rect(x, y + 3, 4, 16).fill(COLORS.primary);

    // Heading text
    doc.fillColor(COLORS.text)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(headingText, x + 12, y);

    return doc.y + 14;
}

// ==================== SUB-HEADING (for tables without numbering) ====================
function subHeading(doc, text, x, y) {
    doc.fillColor(COLORS.textDim)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(text, x, y);
    return doc.y + 10;
}

function ensureSpace(doc, y, needed) {
    if (y + needed > doc.page.height - 70) {
        doc.addPage();
        return 50;
    }
    return y;
}

// ==================== GENERATE PDF REPORT ====================
const generateStyledPDF = (reportData, title, settings) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const fontRegular = 'Helvetica';
            const fontBold = 'Helvetica-Bold';
            const pageWidth = doc.page.width;
            const contentWidth = pageWidth - 100;

            // ==================== HEADER ====================
            doc.rect(0, 0, pageWidth, 120).fill(COLORS.primary);

            const siteName = settings?.site_name || 'WIP Tracking System';
            doc.fillColor(COLORS.white)
                .fontSize(24)
                .font(fontBold)
                .text(siteName, 50, 35, { width: contentWidth });

            doc.fillColor(COLORS.white)
                .fontSize(16)
                .font(fontRegular)
                .text(title, 50, 68, { width: contentWidth });

            const rangeLabel = reportData.dateRange ? ` • Range: ${reportData.dateRange}` : '';
            doc.fillColor(COLORS.white)
                .fontSize(10)
                .font(fontRegular)
                .text(`Generated: ${new Date().toLocaleString()}${rangeLabel}`, 50, 95, { width: contentWidth });

            doc.strokeColor(COLORS.primaryLight)
                .lineWidth(2)
                .moveTo(50, 120)
                .lineTo(pageWidth - 50, 120)
                .stroke();

            let y = 145;

            // Reset section counter for numbered headings
            resetSectionCounter();

            // ==================== SECTION 1: SUMMARY ====================
            const summaryData = reportData.summary || {};
            const summaryItems = Object.entries(summaryData)
                .filter(([, v]) => typeof v === 'number')
                .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()), v]);

            if (summaryItems.length > 0) {
                y = sectionHeading(doc, 'Summary', 50, y);

                const boxX = 50;
                const boxWidth = contentWidth;
                const rows = Math.ceil(summaryItems.length / 2);
                const boxHeight = rows * 28 + 20;

                // Summary box with border
                doc.rect(boxX, y, boxWidth, boxHeight)
                    .stroke(COLORS.border)
                    .fill(COLORS.white);

                summaryItems.forEach(([label, value], index) => {
                    const col = index % 2;
                    const row = Math.floor(index / 2);
                    const cx = col === 0 ? boxX + 20 : boxX + boxWidth / 2 + 10;
                    const cy = y + 18 + row * 28;

                    doc.fillColor(COLORS.textDim)
                        .fontSize(10)
                        .font(fontRegular)
                        .text(`${label}:`, cx, cy, { width: 140, continued: true })
                        .fillColor(COLORS.text)
                        .fontSize(11)
                        .font(fontBold)
                        .text(` ${value}`, { width: 80 });
                });

                y = y + boxHeight + 30;
            }

            // ==================== SECTION 2: BREAKDOWNS ====================
            let hasBreakdowns = false;
            const breakdowns = [];

            if (reportData.byStatus && Object.keys(reportData.byStatus).length > 0) {
                breakdowns.push({ heading: 'Status Breakdown', data: reportData.byStatus, colorMap: STATUS_COLORS });
                hasBreakdowns = true;
            }
            if (reportData.byRole && Object.keys(reportData.byRole).length > 0) {
                breakdowns.push({ heading: 'Role Breakdown', data: reportData.byRole, colorMap: ROLE_COLORS });
                hasBreakdowns = true;
            }
            if (reportData.byMachineStatus && Object.keys(reportData.byMachineStatus).length > 0) {
                breakdowns.push({ heading: 'Machine Status Breakdown', data: reportData.byMachineStatus, colorMap: STATUS_COLORS });
                hasBreakdowns = true;
            }

            if (hasBreakdowns) {
                // Section heading for breakdowns
                let breakdownSectionShown = false;

                breakdowns.forEach((breakdown) => {
                    if (Object.keys(breakdown.data).length === 0) return;

                    y = ensureSpace(doc, y, 120);

                    if (!breakdownSectionShown) {
                        y = sectionHeading(doc, 'Breakdowns', 50, y);
                        breakdownSectionShown = true;
                    } else {
                        y = subHeading(doc, breakdown.heading, 60, y);
                    }

                    const items = Object.entries(breakdown.data);
                    const boxHeight = Math.min(items.length * 28 + 20, 320);

                    doc.rect(50, y, contentWidth, boxHeight)
                        .stroke(COLORS.border)
                        .fill(COLORS.white);

                    let rowY = y + 16;
                    const total = items.reduce((sum, [, val]) => sum + val, 0) || 1;

                    items.forEach(([label, count]) => {
                        const color = breakdown.colorMap[label] || COLORS.info;
                        doc.fillColor(COLORS.textDim)
                            .fontSize(10)
                            .font(fontRegular)
                            .text(`${label}:`, 70, rowY, { width: 120, continued: true })
                            .fillColor(color)
                            .fontSize(11)
                            .font(fontBold)
                            .text(` ${count}`, { width: 50 });

                        const barWidth = 250;
                        const barX = 260;
                        const barY = rowY + 3;
                        const pct = (count / total) * 100;

                        doc.rect(barX, barY, barWidth, 8).fill('#eef2f1');
                        doc.rect(barX, barY, (pct / 100) * barWidth, 8).fill(color);
                        doc.fillColor(COLORS.textMute)
                            .fontSize(8)
                            .font(fontRegular)
                            .text(`${Math.round(pct)}%`, barX + barWidth + 10, barY - 1);

                        rowY += 28;
                    });

                    y = y + boxHeight + 25;
                });
            }

            // ==================== SECTION 3: DETAIL TABLES ====================
            if (reportData.detailSections && reportData.detailSections.length > 0) {
                // Section heading for detail tables
                let detailSectionShown = false;

                reportData.detailSections.forEach((section) => {
                    if (!section.rows || section.rows.length === 0) return;

                    y = ensureSpace(doc, y, 120);

                    if (!detailSectionShown) {
                        y = sectionHeading(doc, 'Detailed Data', 50, y);
                        detailSectionShown = true;
                    }

                    // Sub-heading for each table
                    y = subHeading(doc, section.label, 60, y);

                    // Calculate equal column widths based on available space
                    const totalCols = section.columns.length;
                    const equalWidth = Math.floor(contentWidth / totalCols);

                    const equalColumns = section.columns.map(col => ({
                        ...col,
                        width: equalWidth - 2
                    }));

                    y = drawTable(doc, {
                        x: 50,
                        columns: equalColumns,
                        rows: section.rows,
                        startY: y,
                    });

                    if (section.allRowsCount > section.rows.length) {
                        doc.fillColor(COLORS.textMute)
                            .fontSize(8)
                            .font(fontRegular)
                            .text(`Showing ${section.rows.length} of ${section.allRowsCount} records. Export as Excel for the full dataset.`, 50, y + 6);
                        y += 20;
                    } else {
                        y += 10;
                    }
                });
            }

            // ==================== SECTION 4: RECENT ACTIVITIES ====================
            if (reportData.recentActivities && reportData.recentActivities.length > 0) {
                y = ensureSpace(doc, y, 120);
                y = sectionHeading(doc, 'Recent Activities', 50, y);

                const activityRows = reportData.recentActivities.slice(0, 30).map((a) => ({
                    action: a.action || a.entity || 'Unknown',
                    entity: a.entity || '—',
                    user: a.user?.name || 'System',
                    time: fmtDate(a.createdAt),
                }));

                const activityColumns = [
                    { key: 'action', label: 'Action', width: 110 },
                    { key: 'entity', label: 'Entity', width: 90 },
                    { key: 'user', label: 'User', width: 140 },
                    { key: 'time', label: 'Timestamp', width: 155 },
                ];

                y = drawTable(doc, {
                    x: 50,
                    startY: y,
                    columns: activityColumns,
                    rows: activityRows,
                });
                y += 10;
            }

            // ==================== FOOTER / PAGE NUMBERS ====================
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                doc.switchToPage(i);
                const footerY = doc.page.height - 50;

                const originalBottomMargin = doc.page.margins.bottom;
                doc.page.margins.bottom = 0;

                doc.strokeColor(COLORS.border)
                    .lineWidth(1)
                    .moveTo(50, footerY - 10)
                    .lineTo(pageWidth - 50, footerY - 10)
                    .stroke();

                doc.fillColor(COLORS.textMute)
                    .fontSize(8)
                    .font(fontRegular)
                    .text(`${siteName}`, 50, footerY, {
                        width: 200,
                        align: 'left',
                        lineBreak: false
                    })
                    .text(`Page ${i + 1} of ${pages.count}`, pageWidth - 250, footerY, {
                        width: 200,
                        align: 'right',
                        lineBreak: false
                    });

                doc.page.margins.bottom = originalBottomMargin;
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

// ==================== GENERATE EXCEL REPORT ====================
const generateStyledExcel = async (reportData, title, settings) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = settings?.site_name || 'WIP Tracking System';
    workbook.created = new Date();

    const styleHeaderRow = (row, argb) => {
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
        row.alignment = { vertical: 'middle' };
    };

    // ---- Summary sheet ----
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 28 },
        { header: 'Value', key: 'value', width: 18 },
    ];
    summarySheet.addRow({ metric: 'Report', value: title });
    summarySheet.addRow({ metric: 'Generated', value: new Date().toLocaleString() });
    if (reportData.dateRange) summarySheet.addRow({ metric: 'Date Range', value: reportData.dateRange });
    summarySheet.addRow({});

    const summaryData = reportData.summary || {};
    Object.entries(summaryData).forEach(([key, value]) => {
        if (typeof value !== 'number') return;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        summarySheet.addRow({ metric: label, value });
    });
    styleHeaderRow(summarySheet.getRow(1), 'FF187980');

    // ---- Status breakdown sheets ----
    if (reportData.byStatus && Object.keys(reportData.byStatus).length > 0) {
        const statusSheet = workbook.addWorksheet('Status Breakdown');
        statusSheet.columns = [
            { header: 'Status', key: 'status', width: 20 },
            { header: 'Count', key: 'count', width: 12 },
        ];
        Object.entries(reportData.byStatus).forEach(([status, count]) => {
            statusSheet.addRow({ status, count });
        });
        styleHeaderRow(statusSheet.getRow(1), 'FFFF8C00');
    }

    if (reportData.byRole && Object.keys(reportData.byRole).length > 0) {
        const roleSheet = workbook.addWorksheet('Role Breakdown');
        roleSheet.columns = [
            { header: 'Role', key: 'role', width: 20 },
            { header: 'Count', key: 'count', width: 12 },
        ];
        Object.entries(reportData.byRole).forEach(([role, count]) => {
            roleSheet.addRow({ role, count });
        });
        styleHeaderRow(roleSheet.getRow(1), 'FF1976D2');
    }

    if (reportData.byMachineStatus && Object.keys(reportData.byMachineStatus).length > 0) {
        const machineStatusSheet = workbook.addWorksheet('Machine Status Breakdown');
        machineStatusSheet.columns = [
            { header: 'Status', key: 'status', width: 20 },
            { header: 'Count', key: 'count', width: 12 },
        ];
        Object.entries(reportData.byMachineStatus).forEach(([status, count]) => {
            machineStatusSheet.addRow({ status, count });
        });
        styleHeaderRow(machineStatusSheet.getRow(1), 'FF6A1B9A');
    }

    // ---- Detail sheets ----
    const detailSheetColors = ['FF187980', 'FF0F5F65', 'FF1976D2', 'FF2E7D32', 'FFED6C02', 'FF6A1B9A'];
    if (reportData.detailSections && reportData.detailSections.length > 0) {
        reportData.detailSections.forEach((section, i) => {
            if (!section.allRows || section.allRows.length === 0) return;

            const { columns, allRows, label } = section;
            const sheet = workbook.addWorksheet(label || `Details ${i + 1}`);
            sheet.columns = columns.map((c) => ({
                header: c.label,
                key: c.key,
                width: Math.max(14, Math.round(c.width / 6))
            }));
            allRows.forEach((row) => sheet.addRow(row));
            styleHeaderRow(sheet.getRow(1), detailSheetColors[i % detailSheetColors.length]);
            sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
            sheet.views = [{ state: 'frozen', ySplit: 1 }];
        });
    }

    // ---- Recent activities sheet ----
    if (reportData.recentActivities && reportData.recentActivities.length > 0) {
        const activitySheet = workbook.addWorksheet('Recent Activities');
        activitySheet.columns = [
            { header: '#', key: 'id', width: 6 },
            { header: 'Action', key: 'action', width: 30 },
            { header: 'Entity', key: 'entity', width: 20 },
            { header: 'User', key: 'user', width: 25 },
            { header: 'Timestamp', key: 'timestamp', width: 25 },
        ];
        reportData.recentActivities.forEach((activity, index) => {
            activitySheet.addRow({
                id: index + 1,
                action: activity.action || activity.entity || 'Unknown',
                entity: activity.entity || '—',
                user: activity.user?.name || 'System',
                timestamp: fmtDate(activity.createdAt),
            });
        });
        styleHeaderRow(activitySheet.getRow(1), 'FF2E7D32');
    }

    return workbook;
};

// ==================== BUILD REPORT DATA ====================
const buildDateFilter = (dateRange) => {
    const now = new Date();
    const dateFilter = {};
    switch (dateRange) {
        case 'today':
            dateFilter.gte = new Date(new Date().setHours(0, 0, 0, 0));
            break;
        case 'week':
            dateFilter.gte = new Date(new Date().setDate(now.getDate() - 7));
            break;
        case 'month':
            dateFilter.gte = new Date(new Date().setMonth(now.getMonth() - 1));
            break;
        case 'quarter':
            dateFilter.gte = new Date(new Date().setMonth(now.getMonth() - 3));
            break;
        case 'year':
            dateFilter.gte = new Date(new Date().setFullYear(now.getFullYear() - 1));
            break;
        default:
            dateFilter.gte = new Date(new Date().setDate(now.getDate() - 7));
    }
    return dateFilter;
};

const USER_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR', 'VIEWER'];
const BATCH_STATUSES = ['CREATED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const MACHINE_STATUSES = ['IDLE', 'RUNNING', 'CLEANING', 'DOWN'];

const PDF_ROW_LIMIT = 60;

// ---- Section builders ----
const buildUsersSection = async (dateFilter) => {
    const users = await prisma.user.findMany({
        where: { createdAt: dateFilter },
        select: { name: true, email: true, role: true, isActive: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: 'desc' },
    });

    const allRows = users.map(u => ({
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.isActive ? 'Active' : 'Disabled',
        lastLogin: u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Never',
        createdAt: fmtDateShort(u.createdAt),
    }));

    const columns = [
        { key: 'name', label: 'Name', width: 85 },
        { key: 'email', label: 'Email', width: 140 },
        { key: 'role', label: 'Role', width: 75 },
        { key: 'status', label: 'Status', width: 55 },
        { key: 'lastLogin', label: 'Last Login', width: 135 },
        { key: 'createdAt', label: 'Created', width: 70 },
    ];

    return {
        summary: {
            totalUsers: users.length,
            activeUsers: users.filter(u => u.isActive).length,
            disabledUsers: users.filter(u => !u.isActive).length,
        },
        byRole: USER_ROLES.reduce((acc, role) => {
            acc[role] = users.filter(u => u.role === role).length;
            return acc;
        }, {}),
        section: {
            label: 'Users',
            columns,
            rows: allRows.slice(0, PDF_ROW_LIMIT),
            allRows,
            allRowsCount: allRows.length,
        },
    };
};

const buildBatchesSection = async (dateFilter) => {
    const batches = await prisma.batch.findMany({
        where: { createdAt: dateFilter },
        include: {
            product: true,
            createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    const allRows = batches.map(b => ({
        batchNo: b.batchNo,
        product: b.product?.name || '—',
        size: b.batchSizeText || '—',
        status: b.status,
        createdBy: b.createdBy?.name || '—',
        remarks: b.remarks || '—',
        createdAt: fmtDate(b.createdAt),
        startedAt: b.startedAt ? fmtDate(b.startedAt) : '—',
        completedAt: b.completedAt ? fmtDate(b.completedAt) : '—',
    }));

    const columns = [
        { key: 'batchNo', label: 'Batch No', width: 70 },
        { key: 'product', label: 'Product', width: 90 },
        { key: 'size', label: 'Size', width: 55 },
        { key: 'status', label: 'Status', width: 70 },
        { key: 'createdBy', label: 'Created By', width: 85 },
        { key: 'startedAt', label: 'Started', width: 85 },
        { key: 'completedAt', label: 'Completed', width: 85 },
    ];

    return {
        summary: {
            totalBatches: batches.length,
            completedBatches: batches.filter(b => b.status === 'COMPLETED').length,
            activeBatches: batches.filter(b => ['CREATED', 'IN_PROGRESS', 'ON_HOLD'].includes(b.status)).length,
        },
        byStatus: BATCH_STATUSES.reduce((acc, status) => {
            acc[status] = batches.filter(b => b.status === status).length;
            return acc;
        }, {}),
        section: {
            label: 'Batches',
            columns,
            rows: allRows.slice(0, PDF_ROW_LIMIT),
            allRows,
            allRowsCount: allRows.length,
        },
    };
};

const buildMachinesSection = async (dateFilter) => {
    const machines = await prisma.machine.findMany({
        where: { createdAt: dateFilter },
        include: { stage: { include: { area: true } } },
        orderBy: { createdAt: 'desc' },
    });

    const allRows = machines.map(m => ({
        name: m.name,
        code: m.code || '—',
        area: m.stage?.area?.name || '—',
        stage: m.stage?.name || '—',
        status: m.status,
        active: m.isActive ? 'Yes' : 'No',
        description: m.description || '—',
        createdAt: fmtDateShort(m.createdAt),
    }));

    const columns = [
        { key: 'name', label: 'Machine', width: 85 },
        { key: 'code', label: 'Code', width: 55 },
        { key: 'area', label: 'Area', width: 80 },
        { key: 'stage', label: 'Stage', width: 80 },
        { key: 'status', label: 'Status', width: 65 },
        { key: 'active', label: 'Active', width: 45 },
    ];

    return {
        summary: {
            totalMachines: machines.length,
            activeMachines: machines.filter(m => m.isActive).length,
        },
        byStatus: MACHINE_STATUSES.reduce((acc, status) => {
            acc[status] = machines.filter(m => m.status === status).length;
            return acc;
        }, {}),
        section: {
            label: 'Machines',
            columns,
            rows: allRows.slice(0, PDF_ROW_LIMIT),
            allRows,
            allRowsCount: allRows.length,
        },
    };
};

const buildAreasSection = async () => {
    const areas = await prisma.area.findMany({
        include: { stages: { include: { machines: true } } },
        orderBy: { name: 'asc' },
    });

    const allRows = areas.map(a => ({
        name: a.name,
        code: a.code || '—',
        description: a.description || '—',
        active: a.isActive ? 'Yes' : 'No',
        stageCount: a.stages.length,
        machineCount: a.stages.reduce((sum, s) => sum + s.machines.length, 0),
    }));

    return {
        summary: { totalAreas: areas.length, activeAreas: areas.filter(a => a.isActive).length },
        section: {
            label: 'Areas',
            columns: [
                { key: 'name', label: 'Area', width: 100 },
                { key: 'code', label: 'Code', width: 60 },
                { key: 'active', label: 'Active', width: 50 },
                { key: 'stageCount', label: 'Stages', width: 55 },
                { key: 'machineCount', label: 'Machines', width: 65 },
            ],
            rows: allRows.slice(0, PDF_ROW_LIMIT),
            allRows,
            allRowsCount: allRows.length,
        },
    };
};

const buildStagesSection = async () => {
    const stages = await prisma.stage.findMany({
        include: { area: true, machines: true },
        orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
    });

    const allRows = stages.map(s => ({
        name: s.name,
        area: s.area?.name || '—',
        sequence: s.sequence,
        active: s.isActive ? 'Yes' : 'No',
        machineCount: s.machines.length,
    }));

    return {
        summary: { totalStages: stages.length, activeStages: stages.filter(s => s.isActive).length },
        section: {
            label: 'Stages',
            columns: [
                { key: 'name', label: 'Stage', width: 95 },
                { key: 'area', label: 'Area', width: 90 },
                { key: 'sequence', label: 'Sequence', width: 65 },
                { key: 'active', label: 'Active', width: 50 },
                { key: 'machineCount', label: 'Machines', width: 65 },
            ],
            rows: allRows.slice(0, PDF_ROW_LIMIT),
            allRows,
            allRowsCount: allRows.length,
        },
    };
};

const buildReportData = async (reportType, dateRange) => {
    const dateFilter = buildDateFilter(dateRange);
    let title = 'System Report';
    let reportData = { dateRange };

    switch (reportType) {
        case 'users': {
            title = 'User Report';
            const { summary, byRole, section } = await buildUsersSection(dateFilter);
            reportData = { ...reportData, summary, byRole, detailSections: [section] };
            break;
        }

        case 'batches': {
            title = 'Batch Report';
            const { summary, byStatus, section } = await buildBatchesSection(dateFilter);
            reportData = { ...reportData, summary, byStatus, detailSections: [section] };
            break;
        }

        case 'machines': {
            title = 'Machine Report';
            const { summary, byStatus, section } = await buildMachinesSection(dateFilter);
            reportData = { ...reportData, summary, byStatus, detailSections: [section] };
            break;
        }

        case 'detailed': {
            title = 'Detailed System Report';

            const [usersData, batchesData, machinesData, areasData, stagesData, recentActivities] = await Promise.all([
                buildUsersSection(dateFilter),
                buildBatchesSection(dateFilter),
                buildMachinesSection(dateFilter),
                buildAreasSection(),
                buildStagesSection(),
                prisma.auditLog.findMany({
                    where: { createdAt: dateFilter },
                    take: 100,
                    orderBy: { createdAt: 'desc' },
                    include: { user: { select: { name: true } } },
                }),
            ]);

            reportData = {
                ...reportData,
                summary: {
                    ...usersData.summary,
                    ...areasData.summary,
                    ...stagesData.summary,
                    ...machinesData.summary,
                    ...batchesData.summary,
                },
                byRole: usersData.byRole,
                byStatus: batchesData.byStatus,
                byMachineStatus: machinesData.byStatus,
                detailSections: [
                    usersData.section,
                    batchesData.section,
                    machinesData.section,
                    areasData.section,
                    stagesData.section,
                ],
                recentActivities,
            };
            break;
        }

        case 'summary':
        default: {
            title = 'System Summary Report';

            const [
                totalUsers, activeUsers,
                totalAreas, totalStages,
                totalMachines, activeMachines,
                totalBatches, activeBatches,
                usersByRole, batchesByStatus,
            ] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({ where: { isActive: true } }),
                prisma.area.count(),
                prisma.stage.count(),
                prisma.machine.count(),
                prisma.machine.count({ where: { isActive: true } }),
                prisma.batch.count(),
                prisma.batch.count({ where: { status: { in: ['CREATED', 'IN_PROGRESS', 'ON_HOLD'] } } }),
                Promise.all(USER_ROLES.map(role => prisma.user.count({ where: { role } }))),
                Promise.all(BATCH_STATUSES.map(status => prisma.batch.count({ where: { status } }))),
            ]);

            reportData = {
                ...reportData,
                summary: {
                    totalUsers, activeUsers, totalAreas, totalStages,
                    totalMachines, activeMachines, totalBatches, activeBatches,
                },
                byRole: USER_ROLES.reduce((acc, role, i) => {
                    acc[role] = usersByRole[i];
                    return acc;
                }, {}),
                byStatus: BATCH_STATUSES.reduce((acc, status, i) => {
                    acc[status] = batchesByStatus[i];
                    return acc;
                }, {}),
            };
            break;
        }
    }

    return { reportData, title };
};

// ==================== GENERATE REPORT ENDPOINT ====================
const generateReport = async (req, res, next) => {
    try {
        const { reportType, dateRange, format = 'pdf' } = req.body;

        // Get site settings
        let settings = {};
        try {
            const settingsData = await prisma.systemSetting.findMany();
            settings = settingsData.reduce((acc, s) => {
                try {
                    acc[s.key] = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
                } catch (e) {
                    acc[s.key] = s.value;
                }
                return acc;
            }, {});
        } catch (error) {
            settings = { site_name: 'WIP Tracking System', site_description: 'Work-In-Progress Management' };
        }

        let reportData, title;
        try {
            ({ reportData, title } = await buildReportData(reportType, dateRange));
        } catch (dbError) {
            console.error('Database error while building report data:', dbError);
            return res.status(500).json({
                success: false,
                error: {
                    code: 'REPORT_DATA_ERROR',
                    message: 'Could not load data for this report from the database.',
                },
            });
        }

        if (format === 'excel') {
            const workbook = await generateStyledExcel(reportData, title, settings);
            const buffer = await workbook.xlsx.writeBuffer();

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${title.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
            res.setHeader('Content-Length', buffer.length);
            return res.send(buffer);
        }

        const pdfBuffer = await generateStyledPDF(reportData, title, settings);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${title.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'REPORT_ERROR',
                message: error.message || 'Failed to generate report',
            },
        });
    }
};

module.exports = {
    getStats,
    getRecentActivities,
    generateReport,
};