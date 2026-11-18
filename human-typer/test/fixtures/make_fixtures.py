#!/usr/bin/env python3
"""Generates the .docx fixtures used by docx.test.js.

Uses only the standard library. Run from anywhere:

    python3 human-typer/test/fixtures/make_fixtures.py

The output is deterministic (fixed timestamps), so re-running it does not
change the committed files unless this script changes.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

CONTENT_TYPES = XML + (
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
RELS = XML + (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
)

# "Balk1" mimics a localized (Turkish) style id whose name is still "heading 1".
STYLES = XML + f'''<w:styles {W_NS}>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Balk1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="SubHead"><w:name w:val="Custom Sub Head"/><w:basedOn w:val="Heading2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Loud"><w:name w:val="Loud"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:i w:val="true"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Centered"><w:name w:val="Centered"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>'''

NUMBERING = XML + f'''<w:numbering {W_NS}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
    <w:lvl w:ilvl="2"><w:numFmt w:val="bullet"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>'''


def r(text, props=''):
    rpr = f'<w:rPr>{props}</w:rPr>' if props else ''
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def p(content, ppr=''):
    return f'<w:p><w:pPr>{ppr}</w:pPr>{content}</w:p>' if ppr else f'<w:p>{content}</w:p>'


def style(name):
    return f'<w:pStyle w:val="{name}"/>'


def num(num_id, level):
    return f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num_id}"/></w:numPr>'


def tc(content, tcpr=''):
    return f'<w:tc><w:tcPr>{tcpr}</w:tcPr>{content}</w:tc>'


NESTED_TABLE = (
    '<w:tbl><w:tr>' + tc(p(r('inner one'))) + tc(p(r('inner two'))) + '</w:tr></w:tbl>'
)

TABLE = (
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>'
    '<w:tr>' + tc(p(r('Wide')), '<w:gridSpan w:val="2"/>') + tc(p(r('C1'))) + '</w:tr>'
    '<w:tr>' + tc(p(r('Tall')), '<w:vMerge w:val="restart"/>') + tc(p(r('B2'))) + tc(p(r('C2', '<w:b/>'))) + '</w:tr>'
    '<w:tr>' + tc(p(''), '<w:vMerge/>') + tc(p(r('B3')) + NESTED_TABLE + p('')) + tc(p(r('C3a')) + p(r('C3b'))) + '</w:tr>'
    '</w:tbl>'
)

BODY = ''.join([
    p(r('İstanbul Çalışma Günlüğü'), style('Title')),
    p(r('A subtitle'), style('Subtitle')),
    p(r('Giriş'), style('Balk1')),
    p(r('Second level'), style('Heading2')),
    p(r('Based on heading two'), style('SubHead')),
    p(r('Outline level three'), '<w:outlineLvl w:val="2"/>'),
    # Run formatting; the two leading plain runs must be merged.
    p(r('plain ') + r('still plain ') + r('bold', '<w:b/>') + r(' ') + r('italic', '<w:i/>') + r(' ')
      + r('underline', '<w:u w:val="single"/>') + r(' ') + r('strike', '<w:strike/>') + r(' ')
      + r('all', '<w:b/><w:i/><w:u w:val="double"/><w:strike/>')),
    # Explicitly disabled properties.
    p(r('off', '<w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/><w:strike w:val="0"/>')),
    # Run properties inherited from the paragraph style, one run overriding bold.
    p(r('loud ') + r('quiet', '<w:b w:val="0"/>'), style('Loud')),
    # Character style.
    p(r('strong', '<w:rStyle w:val="Strong"/>') + r(' text')),
    p(r('ığüşöçİĞÜŞÖÇ')),
    p(r('Tom &amp; Jerry &lt;tag&gt; &quot;q&quot; &apos;a&apos; caf&#233; &#x131;&#x11F; &#128512;')),
    p(r('centered'), '<w:jc w:val="center"/>'),
    p(r('right'), '<w:jc w:val="right"/>'),
    p(r('justified'), '<w:jc w:val="both"/>'),
    p(r('centered by style'), style('Centered')),
    p(r('bullet zero'), num(1, 0)),
    p(r('bullet one'), num(1, 1)),
    p(r('bullet two'), num(1, 2)),
    p(r('number zero'), num(2, 0)),
    p(r('number one'), num(2, 1)),
    p(r('bullet by style'), style('ListBullet')),
    p(r('not a list'), num(0, 0)),
    # Line break, carriage return and tab inside one paragraph.
    p('<w:r><w:t>first line</w:t><w:br/><w:t>second line</w:t><w:cr/><w:t>third</w:t><w:tab/><w:t>line</w:t></w:r>',
      '<w:jc w:val="center"/>'),
    p(r('See ') + '<w:hyperlink r:id="rId9">' + r('the site', '<w:u w:val="single"/>') + '</w:hyperlink>' + r(' now')),
    TABLE,
    # Skipped content: two images, a text box, a footnote, a comment.
    p(r('before ')
      + '<w:r><w:drawing><wp:inline><a:graphic/></wp:inline></w:drawing></w:r>'
      + '<w:r><w:pict><v:shape/></w:pict></w:r>'
      + '<w:r><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></w:r>'
      + '<w:r><w:footnoteReference w:id="1"/></w:r>'
      + '<w:r><w:commentReference w:id="0"/></w:r>'
      + r('after')),
    # Tracked changes: deleted text is dropped, inserted text is kept.
    p(r('kept ') + '<w:del><w:r><w:delText>deleted </w:delText></w:r></w:del>'
      + '<w:ins>' + r('inserted') + '</w:ins>'),
    # An attribute value containing '>' and a comment must not confuse the tokenizer.
    '<!-- a comment --><w:p w:rsidR="a>b"><w:r><w:t><![CDATA[cdata <text>]]></w:t></w:r></w:p>',
    '<w:sectPr/>',
])

DOCUMENT = XML + f'<w:document {W_NS}><w:body>{BODY}</w:body></w:document>'

# No styles.xml / numbering.xml: style ids and list kind fall back to defaults.
MINIMAL_DOCUMENT = XML + f'<w:document {W_NS}><w:body>' + ''.join([
    p(r('Heading by id'), style('Heading1')),
    p(r('Title by id'), style('Title')),
    p(r('unknown list'), num(7, 1)),
    p(r('body')),
]) + '</w:body></w:document>'


# Body font from the theme (minor = Cambria) via docDefaults, body size 12 pt
# from the Normal style; a heading in another font and one small run in a
# third font must not win.
FONTS_STYLES = XML + f'''<w:styles {W_NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>'''
FONTS_THEME = XML + (
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements>'
    '<a:fontScheme name="T"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Cambria"/></a:minorFont></a:fontScheme>'
    '</a:themeElements></a:theme>'
)
FONTS_DOCUMENT = XML + f'<w:document {W_NS}><w:body>' + ''.join([
    p(r('A heading that is fairly long but still a heading'), style('Heading1')),
    p(r('Body text in the theme font at twelve points, ') + r('code', '<w:rFonts w:ascii="Courier New"/><w:sz w:val="18"/>') + r(' and more body text.')),
    p(r('Another body paragraph.')),
]) + '</w:body></w:document>'


# Header and footer referenced from the body's sectPr, plus a first-page
# footer. The footer's "Page N of M" paragraph uses one simple and one
# complex field and must be left out.
R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
FOOTER_DOCUMENT = XML + f'<w:document {W_NS} {R_NS}><w:body>' + p(r('Body text.')) + (
    '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>'
    '<w:footerReference w:type="default" r:id="rId2"/><w:footerReference w:type="first" r:id="rId3"/>'
    '<w:titlePg/></w:sectPr>'
) + '</w:body></w:document>'
FOOTER_RELS = XML + (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>'
    '</Relationships>'
)
FOOTER_HEADER = XML + f'<w:hdr {W_NS}>' + p(r('ENV 204 · Ayşe Yılmaz'), '<w:jc w:val="right"/>') + '</w:hdr>'
FOOTER_MAIN = XML + f'<w:ftr {W_NS}>' + p(
    r('Page ') + '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>' + r(' of ')
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
    '<w:jc w:val="center"/>'
) + p(r('Draft', '<w:i/>') + r(' — not for circulation'), '<w:jc w:val="center"/>') + p('') + '</w:ftr>'
FOOTER_FIRST = XML + f'<w:ftr {W_NS}>' + p(r('first page only')) + '</w:ftr>'


# Paragraph and run formatting as typed in rich mode: docDefaults spacing and
# font, a 18 pt title with its own spacing, a smaller run, a hanging indent,
# page-break-before, a manual page break, a table with widths and a fill.
RICH_STYLES = XML + f'''<w:styles {W_NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>'''
RICH_DOCUMENT = XML + f'<w:document {W_NS}><w:body>' + ''.join([
    p(r('Big title', '<w:b/><w:sz w:val="36"/>'), '<w:spacing w:before="0" w:after="720"/>'),
    p(r('Body ') + r('small', '<w:sz w:val="18"/>')),
    p(r('Hanging'), '<w:ind w:left="357" w:hanging="357"/>'),
    p(r('New page'), '<w:pageBreakBefore/>'),
    p(r('Before') + '<w:r><w:br w:type="page"/></w:r>'),
    p(r('After a manual break')),
    '<w:tbl><w:tblGrid><w:gridCol w:w="520"/><w:gridCol w:w="3000"/></w:tblGrid>'
    '<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/></w:tcPr>' + p(r('A')) + '</w:tc><w:tc>' + p(r('B')) + '</w:tc></w:tr>'
    '<w:tr><w:tc>' + p(r('C')) + '</w:tc><w:tc>' + p(r('D')) + '</w:tc></w:tr></w:tbl>',
]) + '</w:body></w:document>'


def write_zip(name, parts, compression):
    path = os.path.join(HERE, name)
    with zipfile.ZipFile(path, 'w') as z:
        for part, data in parts:
            info = zipfile.ZipInfo(part, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = compression
            z.writestr(info, data.encode('utf-8') if isinstance(data, str) else data)
    return path


def main():
    full = [
        ('[Content_Types].xml', CONTENT_TYPES),
        ('_rels/.rels', RELS),
        ('word/document.xml', DOCUMENT),
        ('word/styles.xml', STYLES),
        ('word/numbering.xml', NUMBERING),
        ('word/header1.xml', XML + f'<w:hdr {W_NS}><w:p><w:r><w:t>header</w:t></w:r></w:p></w:hdr>'),
    ]
    write_zip('sample-deflate.docx', full, zipfile.ZIP_DEFLATED)
    write_zip('sample-stored.docx', full, zipfile.ZIP_STORED)
    write_zip('minimal.docx', [('word/document.xml', MINIMAL_DOCUMENT)], zipfile.ZIP_DEFLATED)
    write_zip('fonts.docx', [
        ('word/document.xml', FONTS_DOCUMENT),
        ('word/styles.xml', FONTS_STYLES),
        ('word/theme/theme1.xml', FONTS_THEME),
    ], zipfile.ZIP_DEFLATED)
    write_zip('footer.docx', [
        ('word/document.xml', FOOTER_DOCUMENT),
        ('word/_rels/document.xml.rels', FOOTER_RELS),
        ('word/header1.xml', FOOTER_HEADER),
        ('word/footer1.xml', FOOTER_MAIN),
        ('word/footer2.xml', FOOTER_FIRST),
    ], zipfile.ZIP_DEFLATED)
    write_zip('rich.docx', [
        ('word/document.xml', RICH_DOCUMENT),
        ('word/styles.xml', RICH_STYLES),
    ], zipfile.ZIP_DEFLATED)
    write_zip('no-document.docx', [('hello.txt', 'hello')], zipfile.ZIP_DEFLATED)

    # A stored entry relabelled as deflate, so inflating it must fail.
    path = write_zip('bad-deflate.docx', [('word/document.xml', b'\xff' * 64)], zipfile.ZIP_STORED)
    with open(path, 'rb') as f:
        data = bytearray(f.read())
    local = data.index(b'PK\x03\x04')
    central = data.index(b'PK\x01\x02')
    data[local + 8:local + 10] = b'\x08\x00'
    data[central + 10:central + 12] = b'\x08\x00'
    with open(path, 'wb') as f:
        f.write(data)


if __name__ == '__main__':
    main()
