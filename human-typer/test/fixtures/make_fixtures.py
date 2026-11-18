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
