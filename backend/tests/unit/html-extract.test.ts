import { describe, expect, it } from 'vitest';
import { decodeEntities, extractPage, MAX_TEXT_CHARS, socialFromUrl } from '../../src/lib/html-extract';

const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('extractPage', () => {
  it('reads title, meta description and og:site_name in either attribute order', () => {
    const f = extractPage(
      page(
        `<title>Sharp &amp; Co &ndash; Barbers</title>
         <meta name="description" content="Best cuts in town">
         <meta content="Sharp Co" property="og:site_name">`,
      ),
    );
    expect(f.title).toBe('Sharp & Co – Barbers');
    expect(f.description).toBe('Best cuts in town');
    expect(f.siteName).toBe('Sharp Co');
  });

  it('reads schema.org LocalBusiness JSON-LD: identity, address, phone, year', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BarberShop',
      name: 'Sharp Cuts',
      telephone: '+91 98765 43210',
      foundingDate: '2015-04-01',
      address: { '@type': 'PostalAddress', streetAddress: '12 MG Road', addressLocality: 'Pune', postalCode: '411001' },
      sameAs: ['https://www.instagram.com/sharpcuts/', 'https://example.com/other'],
    };
    const f = extractPage(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
    expect(f.jsonLd).toMatchObject({
      name: 'Sharp Cuts',
      telephone: '+91 98765 43210',
      streetAddress: '12 MG Road',
      locality: 'Pune',
      postalCode: '411001',
      foundingYear: 2015,
    });
    expect(f.socials.instagramUrl).toBe('https://www.instagram.com/sharpcuts');
  });

  it('finds the business inside an @graph and ignores a WebSite node', () => {
    const ld = { '@graph': [{ '@type': 'WebSite', name: 'Site' }, { '@type': 'LocalBusiness', name: 'Real Shop' }] };
    expect(extractPage(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)).jsonLd.name).toBe('Real Shop');
  });

  it('parses openingHoursSpecification (schema.org day URLs and arrays)', () => {
    const ld = {
      '@type': 'LocalBusiness',
      name: 'X',
      openingHoursSpecification: [
        { dayOfWeek: ['Monday', 'https://schema.org/Tuesday'], opens: '09:00:00', closes: '18:30:00' },
        { dayOfWeek: 'Saturday', opens: '10:00', closes: '16:00' },
      ],
    };
    const { hours } = extractPage(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)).jsonLd;
    expect(hours).toEqual([
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:30' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:30' },
      { dayOfWeek: 6, opensAt: '10:00', closesAt: '16:00' },
    ]);
  });

  it('parses compact openingHours strings, including ranges and lists', () => {
    const ld = { '@type': 'LocalBusiness', name: 'X', openingHours: ['Mo-We 09:00-17:00', 'Fr,Sa 10:00-14:00'] };
    const days = extractPage(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)).jsonLd.hours.map((h) => h.dayOfWeek);
    expect(days).toEqual([1, 2, 3, 5, 6]);
  });

  it('survives malformed JSON-LD and keeps reading the other blocks', () => {
    const f = extractPage(
      page(`<script type="application/ld+json">{ not json</script>
            <script type="application/ld+json">{"@type":"LocalBusiness","name":"Still Here"}</script>`),
    );
    expect(f.jsonLd.name).toBe('Still Here');
  });

  it('finds social profiles in links but skips post/share URLs', () => {
    const f = extractPage(
      page(
        '',
        `<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
         <a href="https://instagram.com/p/AbC123/">post</a>
         <a href="https://instagram.com/sharp_cuts?hl=en">ig</a>
         <a href="https://www.facebook.com/SharpCutsPune/">fb</a>
         <a href="https://x.com/sharpcuts">x</a>
         <a href="https://twitter.com/intent/tweet?text=hi">tweet</a>
         <a href="https://www.linkedin.com/company/sharp-cuts/">li</a>`,
      ),
    );
    expect(f.socials).toEqual({
      instagramUrl: 'https://instagram.com/sharp_cuts',
      facebookUrl: 'https://www.facebook.com/SharpCutsPune',
      twitterUrl: 'https://x.com/sharpcuts',
      linkedinUrl: 'https://www.linkedin.com/company/sharp-cuts',
    });
  });

  it('drops scripts, styles and comments from the visible text but keeps content', () => {
    const f = extractPage(
      page(
        '<style>.a{color:red}</style>',
        `<script>var secret = 'do not read';</script><!-- hidden comment -->
         <h1>Sharp Cuts</h1><p>Haircut &mdash; ₹350</p><ul><li>Beard trim</li><li>Shave</li></ul>`,
      ),
    );
    expect(f.text).toContain('Sharp Cuts');
    expect(f.text).toContain('Haircut — ₹350');
    expect(f.text.split('\n')).toEqual(expect.arrayContaining(['Beard trim', 'Shave']));
    expect(f.text).not.toContain('secret');
    expect(f.text).not.toContain('hidden comment');
    expect(f.text).not.toContain('color:red');
  });

  it('collapses repeated short lines (menus/footers) but keeps repeated long content', () => {
    const f = extractPage(page('', '<p>Home</p><p>Home</p><p>Home</p><p>Contact</p>'));
    expect(f.text.split('\n').filter((l) => l === 'Home')).toHaveLength(1);
  });

  it('truncates very long pages to the cap', () => {
    const f = extractPage(page('', Array.from({ length: 2_000 }, (_, i) => `<p>Line number ${i} with some padding text</p>`).join('')));
    expect(f.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(f.text.length).toBeGreaterThan(MAX_TEXT_CHARS - 200);
  });

  it('returns empty facts, not a throw, for junk input', () => {
    const f = extractPage('');
    expect(f).toMatchObject({ title: '', description: '', text: '', socials: {} });
  });
});

describe('socialFromUrl', () => {
  it('maps a profile URL to its network and rejects the wrong host', () => {
    expect(socialFromUrl('http://instagram.com/foo/')).toEqual({ key: 'instagramUrl', url: 'https://instagram.com/foo' });
    expect(socialFromUrl('https://evil.example.com/instagram.com/foo')).toBeNull();
    expect(socialFromUrl('https://instagram.com.evil.com/foo')).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones alone', () => {
    expect(decodeEntities('a &amp; b &#8377;5 &#x20B9;6 &bogus;')).toBe('a & b ₹5 ₹6 &bogus;');
  });
});
