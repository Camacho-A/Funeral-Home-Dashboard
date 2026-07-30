import { describe, expect, it } from 'vitest';
import { sanitizeTemplateBody } from './sanitizeTemplateBody';

describe('sanitizeTemplateBody', () => {
  it('strips <script> tags and their content', () => {
    expect(sanitizeTemplateBody('<p>Hi</p><script>alert(1)</script><p>Bye</p>')).toBe('<p>Hi</p><p>Bye</p>');
  });

  it('strips inline event-handler attributes', () => {
    expect(sanitizeTemplateBody('<img src="a.png" onerror="alert(1)" />')).not.toContain('onerror');
    expect(sanitizeTemplateBody('<div onclick=\'doBad()\'>hi</div>')).not.toContain('onclick');
  });

  it('strips javascript: URLs in href/src', () => {
    const result = sanitizeTemplateBody('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('strips iframe/object/embed tags entirely', () => {
    expect(sanitizeTemplateBody('<iframe src="https://evil.test"></iframe>')).toBe('');
    expect(sanitizeTemplateBody('<object data="x.swf"></object>')).toBe('');
    expect(sanitizeTemplateBody('<embed src="x.swf" />')).toBe('');
  });

  it('leaves ordinary formatting/content untouched', () => {
    const html = '<h1>Cremation Authorization</h1><p>Dear {{case.primaryContact.fullName}},</p><p style="color:red">Important</p>';
    expect(sanitizeTemplateBody(html)).toBe(html);
  });
});
