# Cloudinary Variants - Quick Reference

## For Each Image Field, You Get 7 URLs

| Field Suffix | Purpose  | Transform                                 | When to Use                  |
| ------------ | -------- | ----------------------------------------- | ---------------------------- |
| `UrlBase`    | Original | None                                      | Fallback/debugging           |
| `UrlWeb`     | Website  | `f_auto,q_auto,w_auto,dpr_auto,c_limit`   | Default for all web pages    |
| `UrlEmail`   | Email    | `f_jpg,q_75,w_600,c_limit`                | Email templates              |
| `UrlPdf`     | PDF      | `f_jpg,q_80,w_1200,c_limit`               | PDF documents                |
| `UrlCard`    | Cards    | `f_auto,q_auto,w_300,h_300,c_fill,g_auto` | Product cards, thumbnails    |
| `UrlHero`    | Banners  | `f_auto,q_auto,w_1600,dpr_auto,c_limit`   | Hero sections, large banners |
| `UrlLarge`   | Zoom     | `f_auto,q_auto,w_2000,dpr_auto,c_limit`   | Lightbox, zoom features      |

## Example: CProduct

**API Response includes**:

```
image1CloudUrl      (original - unchanged)
image1UrlBase       (original - duplicate)
image1UrlWeb        (for website)
image1UrlEmail      (for emails)
image1UrlPdf        (for PDFs)
image1UrlCard       (for cards)
image1UrlHero       (for banners)
image1UrlLarge      (for zoom)
```

## Frontend Usage

```jsx
// Product Card
<img src={product.image1UrlCard} />

// Product Page
<img src={product.image1UrlWeb} />

// Email
<img src={product.image1UrlEmail} />

// PDF
<img src={product.image1UrlPdf} />

// Hero Banner
<img src={product.image1UrlHero} />

// Zoom/Lightbox
<img src={product.image1UrlLarge} />
```

## Configured Entities

- **CProduct**: image1, image2, image3
- **CCollection**: collectionImage1
- **CBlog**: blogImage1, blogImage2
- **CAuthor**: authorImage
- **CCompanyInformation**: companyLogo, companyImage
- **CSiteSettings**: siteLogo, siteImage
- **CTopicPage**: topicImage

## Key Points

✅ All transformations happen in Node.js (backend)  
✅ Frontend just uses the fields - no logic needed  
✅ Non-Cloudinary URLs pass through unchanged  
✅ Original `*CloudUrl` fields remain unchanged  
✅ Works automatically on all API endpoints

## Test

```bash
node test-cloudinary-variants.js
```
