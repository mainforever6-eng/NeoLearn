//! Генерация PDF-конспекта урока.
//!
//! PDF собирается вручную, без сторонних PDF-библиотек: так сборка под Android
//! и iOS не зависит от платформенных линкеров и лишних нативных зависимостей.
//! Шрифты PT Sans / PT Mono (лицензия OFL) встроены в бинарник, поэтому
//! кириллица корректно отображается на всех платформах.

use crate::lessons::{self, Block, Lesson};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Write as _;
use ttf_parser::{Face, GlyphId};

const PAGE_W: f32 = 210.0;
const PAGE_H: f32 = 297.0;
const MARGIN_X: f32 = 18.0;
const MARGIN_TOP: f32 = 18.0;
const MARGIN_BOTTOM: f32 = 18.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN_X;
const MM_PER_PT: f32 = 25.4 / 72.0;
const PT_PER_MM: f32 = 72.0 / 25.4;

type RgbTuple = (f32, f32, f32);

const TEXT: RgbTuple = (0.11, 0.12, 0.15);
const MUTED: RgbTuple = (0.42, 0.45, 0.50);
const ACCENT: RgbTuple = (0.16, 0.40, 0.85);
const DIVIDER: RgbTuple = (0.85, 0.87, 0.90);
const CODE_BG: RgbTuple = (0.95, 0.96, 0.975);
const TIP_BG: RgbTuple = (0.90, 0.96, 0.91);
const TIP_BAR: RgbTuple = (0.22, 0.63, 0.36);
const WARN_BG: RgbTuple = (1.0, 0.95, 0.88);
const WARN_BAR: RgbTuple = (0.91, 0.55, 0.13);
const TAKE_BG: RgbTuple = (0.92, 0.945, 1.0);
const TAKE_BAR: RgbTuple = (0.16, 0.40, 0.85);

// Шрифты распространяются по лицензии SIL Open Font License, файлы лицензий
// лежат рядом: assets/fonts/OFL-PTSans.txt и OFL-PTMono.txt.
const FONT_REGULAR: &[u8] = include_bytes!("../assets/fonts/PTSans-Regular.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../assets/fonts/PTSans-Bold.ttf");
const FONT_MONO: &[u8] = include_bytes!("../assets/fonts/PTMono-Regular.ttf");

#[derive(Clone, Copy, PartialEq, Eq)]
enum FaceKind {
    Regular,
    Bold,
    Mono,
}

impl FaceKind {
    fn index(self) -> usize {
        match self {
            FaceKind::Regular => 0,
            FaceKind::Bold => 1,
            FaceKind::Mono => 2,
        }
    }

    fn resource(self) -> &'static str {
        match self {
            FaceKind::Regular => "F1",
            FaceKind::Bold => "F2",
            FaceKind::Mono => "F3",
        }
    }
}

const FONT_NAMES: [&str; 3] = ["PT Sans", "PT Sans Bold", "PT Mono"];
const PDF_FONT_NAMES: [&str; 3] = ["PTSans-Regular", "PTSans-Bold", "PTMono-Regular"];
const FONT_BYTES: [&[u8]; 3] = [FONT_REGULAR, FONT_BOLD, FONT_MONO];

/// Встроенные шрифты и карта использованных глифов (нужна для /ToUnicode).
struct Fonts {
    faces: [Face<'static>; 3],
    used: [BTreeMap<u16, char>; 3],
}

impl Fonts {
    fn new() -> Result<Self, String> {
        let parse = |bytes: &'static [u8], name: &str| {
            Face::parse(bytes, 0).map_err(|e| format!("Не удалось прочитать шрифт {name}: {e}"))
        };
        Ok(Self {
            faces: [
                parse(FONT_BYTES[0], FONT_NAMES[0])?,
                parse(FONT_BYTES[1], FONT_NAMES[1])?,
                parse(FONT_BYTES[2], FONT_NAMES[2])?,
            ],
            used: Default::default(),
        })
    }

    fn face(&self, kind: FaceKind) -> &Face<'static> {
        &self.faces[kind.index()]
    }

    fn char_width_mm(&self, kind: FaceKind, ch: char, size_pt: f32) -> f32 {
        let face = self.face(kind);
        let units = face.units_per_em().max(1) as f32;
        let advance = face
            .glyph_index(ch)
            .and_then(|glyph| face.glyph_hor_advance(glyph))
            .unwrap_or(0) as f32;
        advance / units * size_pt * MM_PER_PT
    }

    fn width_mm(&self, kind: FaceKind, text: &str, size_pt: f32) -> f32 {
        text.chars()
            .map(|ch| self.char_width_mm(kind, ch, size_pt))
            .sum()
    }

    /// Кодирует строку в Identity-H: по 4 hex-цифры на глиф.
    fn encode(&mut self, kind: FaceKind, text: &str) -> String {
        let face = &self.faces[kind.index()];
        let used = &mut self.used[kind.index()];
        let mut out = String::with_capacity(text.len() * 4);
        for ch in text.chars() {
            let glyph = face.glyph_index(ch);
            let gid = glyph.map(|g| g.0).unwrap_or(0);
            if let Some(glyph) = glyph {
                used.entry(glyph.0).or_insert(ch);
            }
            let _ = write!(out, "{gid:04X}");
        }
        out
    }
}

pub fn pdf_for(lesson: &Lesson) -> Result<Vec<u8>, String> {
    let mut builder = Builder::new()?;
    builder.render(lesson);
    builder.finish()
}

struct Builder {
    /// Готовые потоки содержимого страниц.
    pages: Vec<String>,
    /// Поток текущей страницы.
    current: String,
    y: f32,
    page: u32,
    fill: RgbTuple,
    fonts: Fonts,
}

impl Builder {
    fn new() -> Result<Self, String> {
        let mut builder = Self {
            pages: Vec::new(),
            current: String::new(),
            y: MARGIN_TOP,
            page: 1,
            fill: TEXT,
            fonts: Fonts::new()?,
        };
        builder.footer();
        Ok(builder)
    }

    fn finish(mut self) -> Result<Vec<u8>, String> {
        self.pages.push(std::mem::take(&mut self.current));
        Ok(build_document(&self.fonts, &self.pages))
    }

    fn set_fill(&mut self, rgb: RgbTuple) {
        self.fill = rgb;
    }

    fn fill_rect(&mut self, x: f32, top: f32, width: f32, height: f32) {
        let (r, g, b) = self.fill;
        let _ = write!(
            self.current,
            "{r:.4} {g:.4} {b:.4} rg\n{:.2} {:.2} {:.2} {:.2} re\nf\n",
            x * PT_PER_MM,
            (PAGE_H - top - height) * PT_PER_MM,
            width * PT_PER_MM,
            height * PT_PER_MM,
        );
    }

    fn draw_text(&mut self, x: f32, top: f32, text: &str, size: f32, kind: FaceKind) {
        if text.is_empty() {
            return;
        }
        let baseline = PAGE_H - top - size * MM_PER_PT * 0.80;
        let hex = self.fonts.encode(kind, text);
        let (r, g, b) = self.fill;
        let _ = write!(
            self.current,
            "BT\n/{} {:.2} Tf\n{r:.4} {g:.4} {b:.4} rg\n{:.2} {:.2} Td\n<{hex}> Tj\nET\n",
            kind.resource(),
            size,
            x * PT_PER_MM,
            baseline * PT_PER_MM,
        );
    }

    fn footer(&mut self) {
        let label = format!("NeoLang · {}", self.page);
        let width = self.fonts.width_mm(FaceKind::Regular, &label, 8.0);
        let top = PAGE_H - 10.0 - 8.0 * MM_PER_PT * 0.80;
        self.set_fill(MUTED);
        self.draw_text(
            PAGE_W - MARGIN_X - width,
            top,
            &label,
            8.0,
            FaceKind::Regular,
        );
    }

    fn new_page(&mut self) {
        self.pages.push(std::mem::take(&mut self.current));
        self.page += 1;
        self.y = MARGIN_TOP;
        self.footer();
    }

    fn ensure_space(&mut self, height: f32) {
        if self.y + height > PAGE_H - MARGIN_BOTTOM {
            self.new_page();
        }
    }

    fn paragraph(
        &mut self,
        text: &str,
        size: f32,
        kind: FaceKind,
        rgb: RgbTuple,
        line_factor: f32,
    ) {
        self.paragraph_at(MARGIN_X, CONTENT_W, text, size, kind, rgb, line_factor);
    }

    fn paragraph_at(
        &mut self,
        x: f32,
        width: f32,
        text: &str,
        size: f32,
        kind: FaceKind,
        rgb: RgbTuple,
        line_factor: f32,
    ) {
        let line_height = size * MM_PER_PT * line_factor;
        let lines = wrap_text(&self.fonts, kind, size, text, width);
        for line in lines {
            self.ensure_space(line_height);
            self.set_fill(rgb);
            self.draw_text(x, self.y, &line, size, kind);
            self.y += line_height;
        }
    }

    fn section_title(&mut self, title: &str) {
        let size = 13.0;
        let line_height = size * MM_PER_PT * 1.35;
        self.y += 1.5;
        self.ensure_space(line_height + 2.0);
        self.set_fill(ACCENT);
        self.draw_text(MARGIN_X, self.y, &clean_inline(title), size, FaceKind::Bold);
        self.y += line_height + 1.0;
    }

    fn subheading(&mut self, title: &str) {
        let size = 11.0;
        let line_height = size * MM_PER_PT * 1.4;
        let lines = wrap_text(&self.fonts, FaceKind::Bold, size, title, CONTENT_W);
        for line in lines {
            self.ensure_space(line_height);
            self.set_fill(TEXT);
            self.draw_text(MARGIN_X, self.y, &line, size, FaceKind::Bold);
            self.y += line_height;
        }
        self.y += 0.5;
    }

    fn list_item(&mut self, marker: &str, text: &str) {
        let size = 10.5;
        let indent = 6.0;
        let line_height = size * MM_PER_PT * 1.45;
        let lines = wrap_text(
            &self.fonts,
            FaceKind::Regular,
            size,
            &clean_inline(text),
            CONTENT_W - indent,
        );
        for (index, line) in lines.iter().enumerate() {
            self.ensure_space(line_height);
            if index == 0 {
                self.set_fill(ACCENT);
                self.draw_text(MARGIN_X, self.y, marker, size, FaceKind::Bold);
            }
            self.set_fill(TEXT);
            self.draw_text(MARGIN_X + indent, self.y, line, size, FaceKind::Regular);
            self.y += line_height;
        }
        self.y += 1.0;
    }

    fn code_block(&mut self, title: &str, lang: &str, code: &str) {
        let title = clean_inline(title);
        if !title.is_empty() {
            self.subheading(&title);
        } else if !lang.is_empty() {
            self.subheading(lang);
        }

        let size = 8.5;
        let padding = 3.0;
        let line_height = size * MM_PER_PT * 1.4;
        let inner_width = CONTENT_W - 2.0 * padding;
        let lines = wrap_code(&self.fonts, code, size, inner_width);

        let total_height = padding * 2.0 + lines.len() as f32 * line_height;
        let full_page = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
        if self.y + total_height > PAGE_H - MARGIN_BOTTOM && total_height <= full_page {
            self.new_page();
        }

        let mut index = 0;
        while index < lines.len() {
            if self.y + padding * 2.0 + line_height > PAGE_H - MARGIN_BOTTOM {
                self.new_page();
            }
            let available = PAGE_H - MARGIN_BOTTOM - (self.y + padding * 2.0);
            let count = ((available / line_height).floor() as usize).clamp(1, lines.len() - index);
            let block_height = padding * 2.0 + count as f32 * line_height;

            self.set_fill(CODE_BG);
            self.fill_rect(MARGIN_X, self.y, CONTENT_W, block_height);

            let mut line_top = self.y + padding;
            for line in &lines[index..index + count] {
                self.set_fill(TEXT);
                self.draw_text(MARGIN_X + padding, line_top, line, size, FaceKind::Mono);
                line_top += line_height;
            }

            index += count;
            self.y += block_height;
            if index < lines.len() {
                self.new_page();
            } else {
                self.y += 1.5;
            }
        }
    }

    fn note_box(&mut self, title: &str, body: &str, background: RgbTuple, bar: RgbTuple) {
        let title = clean_inline(title);
        let body = clean_inline(body);
        let title_size = 10.5;
        let body_size = 10.0;
        let title_height = title_size * MM_PER_PT * 1.4;
        let body_height = body_size * MM_PER_PT * 1.45;
        let padding = 3.5;
        let bar_width = 2.0;
        let inner_width = CONTENT_W - 2.0 * padding - bar_width;

        let title_lines = if title.is_empty() {
            Vec::new()
        } else {
            wrap_text(&self.fonts, FaceKind::Bold, title_size, &title, inner_width)
        };
        let body_lines = wrap_text(
            &self.fonts,
            FaceKind::Regular,
            body_size,
            &body,
            inner_width,
        );

        let title_gap = if title_lines.is_empty() { 0.0 } else { 1.0 };
        let height = padding * 2.0
            + title_lines.len() as f32 * title_height
            + title_gap
            + body_lines.len() as f32 * body_height;

        if self.y + height > PAGE_H - MARGIN_BOTTOM {
            self.new_page();
        }

        // Если блок выше целой страницы, рисуем его как обычный текст.
        if height > PAGE_H - MARGIN_TOP - MARGIN_BOTTOM {
            if !title.is_empty() {
                self.subheading(&title);
            }
            self.paragraph(&body, body_size, FaceKind::Regular, TEXT, 1.45);
            self.y += 1.0;
            return;
        }

        self.set_fill(background);
        self.fill_rect(MARGIN_X, self.y, CONTENT_W, height);
        self.set_fill(bar);
        self.fill_rect(MARGIN_X, self.y, bar_width, height);

        let x = MARGIN_X + padding + bar_width;
        let mut line_top = self.y + padding;
        for line in &title_lines {
            self.set_fill(TEXT);
            self.draw_text(x, line_top, line, title_size, FaceKind::Bold);
            line_top += title_height;
        }
        line_top += title_gap;
        for line in &body_lines {
            self.set_fill(TEXT);
            self.draw_text(x, line_top, line, body_size, FaceKind::Regular);
            line_top += body_height;
        }

        self.y += height + 1.5;
    }

    fn header(&mut self, lesson: &Lesson) {
        let label = format!(
            "{} · УРОК {}",
            lessons::course_title(&lesson.course).to_uppercase(),
            lesson.id
        );
        self.set_fill(ACCENT);
        self.draw_text(MARGIN_X, self.y, &label, 8.5, FaceKind::Bold);
        self.y += 8.5 * MM_PER_PT * 1.9;

        let title_size = 22.0;
        let title_height = title_size * MM_PER_PT * 1.2;
        let title_lines = wrap_text(
            &self.fonts,
            FaceKind::Bold,
            title_size,
            &clean_inline(&lesson.title),
            CONTENT_W,
        );
        for line in title_lines {
            self.ensure_space(title_height);
            self.set_fill(TEXT);
            self.draw_text(MARGIN_X, self.y, &line, title_size, FaceKind::Bold);
            self.y += title_height;
        }

        self.y += 1.0;
        self.paragraph(
            &clean_inline(&lesson.subtitle),
            11.0,
            FaceKind::Regular,
            MUTED,
            1.45,
        );
        self.paragraph(
            &format!("{} · {}", lesson.duration, lesson.level),
            9.0,
            FaceKind::Regular,
            MUTED,
            1.4,
        );

        self.y += 2.5;
        self.set_fill(DIVIDER);
        self.fill_rect(MARGIN_X, self.y, CONTENT_W, 0.4);
        self.y += 3.5;
    }

    fn render(&mut self, lesson: &Lesson) {
        self.header(lesson);

        if !lesson.goals.is_empty() {
            self.section_title("Чему вы научитесь");
            for goal in &lesson.goals {
                self.list_item("•", goal);
            }
            self.y += 1.0;
        }

        for block in &lesson.blocks {
            match block {
                Block::Text { title, body } => {
                    self.section_title(title);
                    self.paragraph(&clean_inline(body), 10.5, FaceKind::Regular, TEXT, 1.5);
                    self.y += 1.0;
                }
                Block::List { title, items } => {
                    self.section_title(title);
                    for item in items {
                        self.list_item("•", item);
                    }
                    self.y += 1.0;
                }
                Block::Code { title, lang, code } => self.code_block(title, lang, code),
                Block::Tip { title, body } => self.note_box(title, body, TIP_BG, TIP_BAR),
                Block::Warning { title, body } => self.note_box(title, body, WARN_BG, WARN_BAR),
            }
        }

        if !lesson.practice.is_empty() {
            self.section_title("Практика");
            for (index, item) in lesson.practice.iter().enumerate() {
                self.list_item(&format!("{}.", index + 1), item);
            }
            self.y += 1.0;
        }

        if !lesson.takeaways.is_empty() {
            let body = lesson
                .takeaways
                .iter()
                .map(|item| format!("• {item}"))
                .collect::<Vec<_>>()
                .join("\n");
            self.note_box("Запомнить", &body, TAKE_BG, TAKE_BAR);
        }
    }
}

/// Убирает markdown-разметку, которая не нужна в PDF.
fn clean_inline(text: &str) -> String {
    text.replace('`', "").replace("**", "")
}

fn wrap_text(fonts: &Fonts, kind: FaceKind, size: f32, text: &str, max_width: f32) -> Vec<String> {
    let mut lines = Vec::new();

    for raw in text.split('\n') {
        let raw = raw.trim_end();
        if raw.trim().is_empty() {
            lines.push(String::new());
            continue;
        }

        let mut current = String::new();
        for word in raw.split_whitespace() {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };

            if fonts.width_mm(kind, &candidate, size) <= max_width {
                current = candidate;
                continue;
            }

            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }

            if fonts.width_mm(kind, word, size) <= max_width {
                current = word.to_string();
            } else {
                let mut chunk = String::new();
                let mut chunk_width = 0.0;
                for ch in word.chars() {
                    let width = fonts.char_width_mm(kind, ch, size);
                    if chunk_width + width > max_width && !chunk.is_empty() {
                        lines.push(std::mem::take(&mut chunk));
                        chunk_width = 0.0;
                    }
                    chunk.push(ch);
                    chunk_width += width;
                }
                current = chunk;
            }
        }

        if !current.is_empty() {
            lines.push(current);
        }
    }

    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn wrap_code(fonts: &Fonts, text: &str, size: f32, max_width: f32) -> Vec<String> {
    let mut lines = Vec::new();

    for raw in text.split('\n') {
        let expanded = raw.replace('\t', "    ");
        if expanded.is_empty() {
            lines.push(String::new());
            continue;
        }

        let mut chunk = String::new();
        let mut chunk_width = 0.0;
        for ch in expanded.chars() {
            let width = fonts.char_width_mm(FaceKind::Mono, ch, size);
            if chunk_width + width > max_width && !chunk.is_empty() {
                lines.push(std::mem::take(&mut chunk));
                chunk_width = 0.0;
            }
            chunk.push(ch);
            chunk_width += width;
        }
        if !chunk.is_empty() {
            lines.push(chunk);
        }
    }

    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/* ------------------------------------------------------------------------- */
/*  Минимальный PDF-сериализатор                                             */
/* ------------------------------------------------------------------------- */

/// Номера объектов: 1 — каталог, 2 — дерево страниц, затем по 5 объектов на
/// каждый шрифт (Type0, CIDFont, дескриптор, FontFile2, ToUnicode).
const FIRST_FONT_ID: u32 = 3;
const OBJECTS_PER_FONT: u32 = 5;
const FIRST_PAGE_ID: u32 = FIRST_FONT_ID + 3 * OBJECTS_PER_FONT;

fn build_document(fonts: &Fonts, pages: &[String]) -> Vec<u8> {
    let page_count = pages.len() as u32;
    let total_objects = FIRST_PAGE_ID + page_count * 2 - 1;
    let mut offsets = vec![0usize; total_objects as usize + 1];
    let mut out = Vec::new();
    out.extend_from_slice(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");

    push_obj(
        &mut out,
        &mut offsets,
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>",
    );

    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", FIRST_PAGE_ID + index * 2))
        .collect::<Vec<_>>()
        .join(" ");
    push_obj(
        &mut out,
        &mut offsets,
        2,
        format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>").as_bytes(),
    );

    for (index, kind) in [FaceKind::Regular, FaceKind::Bold, FaceKind::Mono]
        .into_iter()
        .enumerate()
    {
        let base = FIRST_FONT_ID + index as u32 * OBJECTS_PER_FONT;
        push_font_objects(&mut out, &mut offsets, base, fonts, kind);
    }

    for (index, content) in pages.iter().enumerate() {
        let page_id = FIRST_PAGE_ID + index as u32 * 2;
        let content_id = page_id + 1;
        let page_object = format!(
            "<< /Type /Page /Parent 2 0 R \
             /MediaBox [0 0 {:.2} {:.2}] \
             /Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R /F3 {f3} 0 R >> >> \
             /Contents {content_id} 0 R >>",
            PAGE_W * PT_PER_MM,
            PAGE_H * PT_PER_MM,
            f1 = FIRST_FONT_ID,
            f2 = FIRST_FONT_ID + OBJECTS_PER_FONT,
            f3 = FIRST_FONT_ID + 2 * OBJECTS_PER_FONT,
        );
        push_obj(&mut out, &mut offsets, page_id, page_object.as_bytes());

        let mut stream = Vec::new();
        let _ = write!(
            stream,
            "<< /Length {} >>\nstream\n",
            content.as_bytes().len()
        );
        stream.extend_from_slice(content.as_bytes());
        stream.extend_from_slice(b"\nendstream");
        push_obj(&mut out, &mut offsets, content_id, &stream);
    }

    let xref_offset = out.len();
    let _ = write!(out, "xref\n0 {}\n", total_objects + 1);
    out.extend_from_slice(b"0000000000 65535 f \n");
    for id in 1..=total_objects {
        let _ = write!(out, "{:010} 00000 n \n", offsets[id as usize]);
    }
    let _ = write!(
        out,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
        total_objects + 1
    );

    out
}

fn push_obj(out: &mut Vec<u8>, offsets: &mut [usize], id: u32, body: &[u8]) {
    offsets[id as usize] = out.len();
    let _ = write!(out, "{id} 0 obj\n");
    out.extend_from_slice(body);
    out.extend_from_slice(b"\nendobj\n");
}

fn push_font_objects(
    out: &mut Vec<u8>,
    offsets: &mut [usize],
    base: u32,
    fonts: &Fonts,
    kind: FaceKind,
) {
    let index = kind.index();
    let face = fonts.face(kind);
    let name = PDF_FONT_NAMES[index];
    let upm = face.units_per_em().max(1) as f32;
    let scale = |value: i16| (value as f32 * 1000.0 / upm).round() as i32;
    let bbox = face.global_bounding_box();
    let ascent = scale(face.ascender());
    let descent = scale(face.descender());
    let cap_height = face.capital_height().map(scale).unwrap_or(ascent);

    let type0 = format!(
        "<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H \
         /DescendantFonts [{} 0 R] /ToUnicode {} 0 R >>",
        base + 1,
        base + 4
    );
    push_obj(out, offsets, base, type0.as_bytes());

    let cid_font = format!(
        "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{name} \
         /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> \
         /FontDescriptor {} 0 R /DW 1000 /W {} /CIDToGIDMap /Identity >>",
        base + 2,
        width_array(fonts, kind),
    );
    push_obj(out, offsets, base + 1, cid_font.as_bytes());

    let descriptor = format!(
        "<< /Type /FontDescriptor /FontName /{name} /Flags 32 /FontBBox [{} {} {} {}] \
         /ItalicAngle 0 /Ascent {ascent} /Descent {descent} /CapHeight {cap_height} \
         /StemV 80 /FontFile2 {} 0 R >>",
        scale(bbox.x_min),
        scale(bbox.y_min),
        scale(bbox.x_max),
        scale(bbox.y_max),
        base + 3
    );
    push_obj(out, offsets, base + 2, descriptor.as_bytes());

    let data = FONT_BYTES[index];
    let mut font_stream = Vec::with_capacity(data.len() + 64);
    let _ = write!(
        font_stream,
        "<< /Length {} /Length1 {} >>\nstream\n",
        data.len(),
        data.len()
    );
    font_stream.extend_from_slice(data);
    font_stream.extend_from_slice(b"\nendstream");
    push_obj(out, offsets, base + 3, &font_stream);

    let cmap = to_unicode_cmap(fonts, kind);
    let mut cmap_stream = Vec::with_capacity(cmap.len() + 64);
    let _ = write!(
        cmap_stream,
        "<< /Length {} >>\nstream\n",
        cmap.as_bytes().len()
    );
    cmap_stream.extend_from_slice(cmap.as_bytes());
    cmap_stream.extend_from_slice(b"\nendstream");
    push_obj(out, offsets, base + 4, &cmap_stream);
}

fn width_array(fonts: &Fonts, kind: FaceKind) -> String {
    let face = fonts.face(kind);
    let upm = face.units_per_em().max(1) as f32;
    let used = &fonts.used[kind.index()];
    let mut gids: Vec<u16> = used.keys().copied().collect();
    gids.push(0);
    gids.sort_unstable();
    gids.dedup();

    let mut out = String::from("[");
    for gid in gids {
        let width = face
            .glyph_hor_advance(GlyphId(gid))
            .map(|advance| (advance as f32 * 1000.0 / upm).round() as i32)
            .unwrap_or(0);
        let _ = write!(out, " {gid} [{width}]");
    }
    out.push_str(" ]");
    out
}

fn to_unicode_cmap(fonts: &Fonts, kind: FaceKind) -> String {
    let name = PDF_FONT_NAMES[kind.index()];
    let mut out = String::new();
    out.push_str("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n");
    let _ = write!(
        out,
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /{name}-UCS def\n/CMapType 2 def\n\
         1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
    );

    let entries: Vec<(u16, char)> = fonts.used[kind.index()]
        .iter()
        .map(|(&gid, &ch)| (gid, ch))
        .collect();
    for chunk in entries.chunks(100) {
        let _ = writeln!(out, "{} beginbfchar", chunk.len());
        for (gid, ch) in chunk {
            let mut utf16 = [0u16; 2];
            let units = ch.encode_utf16(&mut utf16);
            let _ = write!(out, "<{gid:04X}> <");
            for unit in units {
                let _ = write!(out, "{unit:04X}");
            }
            out.push_str(">\n");
        }
        out.push_str("endbfchar\n");
    }

    out.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_non_empty_pdf() {
        let lesson = lessons::find_lesson("rust", 1).expect("урок существует");
        let pdf = pdf_for(&lesson).expect("PDF собирается");
        assert!(pdf.starts_with(b"%PDF"));
        assert!(
            pdf.len() > 500_000,
            "PDF слишком маленький: {} байт",
            pdf.len()
        );
    }

    #[test]
    fn builds_pdf_with_code_and_boxes() {
        let lesson = lessons::find_lesson("rust", 2).expect("урок существует");
        let pdf = pdf_for(&lesson).expect("PDF собирается");
        assert!(pdf.starts_with(b"%PDF"));
        assert!(pdf.len() > 500_000);
    }
}
