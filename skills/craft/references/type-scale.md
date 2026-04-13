# Type Scale

## Base Configuration

Base: 16px

Choose your scale ratio:
- **1.25** for product/app UI (less aggressive spacing)
- **1.333** for more editorial layouts (more generous spacing)

## Token Definitions

```css
--text-xs:   0.75rem    /* 12px */
--text-sm:   0.875rem   /* 14px */
--text-base: 1rem       /* 16px */
--text-lg:   1.25rem    /* 20px */
--text-xl:   1.563rem   /* 25px */
--text-2xl:  1.953rem   /* 31px */
--text-3xl:  2.441rem   /* 39px */
--text-4xl:  3.052rem   /* 49px */
```

## Implementation Tips

- Test each size at its intended context (body, heading, nav) before committing
- Maintain consistent line-height to weight ratio
- Consider mobile breakpoints—larger base sizes may need scaling down on small screens

