@AGENTS.md

# CLAUDE.md

## Project Philosophy
Build fast, clean, production-ready software with minimal complexity.

Prioritize:
- Simplicity over abstraction
- Readability over cleverness
- Shipping over perfection
- Maintainability over premature scalability
- Excellent UX with minimal UI noise

Avoid over-engineering at all costs.

---

# Core Principles

## 1. Keep Architecture Simple
- Use the simplest solution that works
- Avoid unnecessary layers, services, wrappers, or patterns
- Do not introduce microservices unless absolutely required
- Prefer monolith + modular structure
- Avoid excessive dependency usage

## 2. Minimalist Modern UI
Design philosophy:
- Clean spacing
- Strong typography
- Minimal colors
- Subtle borders and shadows
- High readability
- Few but meaningful interactions

### UI Guidelines
- Prefer whitespace over dividers
- Avoid cluttered dashboards
- Maximum 1 primary action per section
- Use concise copy
- Avoid unnecessary icons
- Use smooth but subtle animations
- Mobile-first responsive layouts

### Preferred Stack
- Tailwind CSS
- shadcn/ui
- Framer Motion only when necessary
- Lucide icons

### Avoid
- Glassmorphism overload
- Excessive gradients
- Complex animations
- Nested modals
- Dense tables unless necessary
- Overly colorful interfaces

---

# Engineering Standards

## Code Style
- Write self-documenting code
- Prefer explicit naming
- Keep files small and focused
- Avoid deeply nested logic
- Remove dead code immediately
- Favor composition over inheritance

## File Limits
Target:
- Components: < 200 lines
- Pages: < 300 lines
- Functions: < 50 lines where possible

If a file grows too large:
- Split by responsibility
- Not by arbitrary technical layers

---

# Frontend Rules

## Preferred Frontend Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Query or server actions
- Zod for validation

## State Management
Default:
- Local state first
- Context only if truly shared
- Avoid Redux unless absolutely necessary

## Forms
- Prefer React Hook Form + Zod
- Inline validation
- Minimal fields
- Smart defaults

## Components
Create:
- Reusable UI primitives
- Feature-focused components

Avoid:
- Massive shared utility components
- Premature component abstraction

Rule:
If duplication occurs fewer than 3 times, duplication is acceptable.

---

# Backend Rules

## API Design
- Keep endpoints predictable
- Prefer REST unless GraphQL is clearly beneficial
- Keep business logic close to domain logic
- Validate all inputs

## Database
- Use clean relational models
- Avoid excessive normalization
- Add indexes only when needed
- Prefer Supabase (current stack) — Prisma only if introduced intentionally

## Auth
- Use managed auth providers where possible
- Keep auth simple and secure

---

# AI Integration Principles

When implementing AI features:
- Keep AI flows transparent
- Always show loading/progress states
- Allow editing of generated content
- Never block users behind AI
- AI should assist, not control

## Prompt Engineering
- Keep prompts modular
- Store prompts centrally in `lib/ai/prompts.ts`
- Version important prompts
- Avoid giant monolithic prompts

---

# Product Thinking

Every feature should answer:
1. Does this solve a real user problem?
2. Can this be simplified further?
3. Is this the smallest lovable version?
4. Does this improve UX or just add complexity?

If unsure: cut scope.

---

# Performance Standards
- Fast initial load
- Minimize client-side JS
- Prefer server components where possible
- Lazy load heavy features
- Optimize images automatically

Target:
- Lighthouse > 90
- Accessible by default

---

# UX Standards

## Good UX
- Obvious navigation
- Minimal clicks
- Clear hierarchy
- Helpful empty states
- Fast feedback loops

## Avoid
- Feature overload
- Too many settings
- Hidden actions
- Complex onboarding
- Excessive notifications

---

# Error Handling
- Fail gracefully
- Show human-readable errors
- Never expose raw stack traces
- Log useful debugging information

---

# Security
- Validate everything
- Sanitize user input
- Never expose secrets
- Use environment variables properly
- Principle of least privilege

---

# Development Workflow

## Before Writing Code
Ask:
- Is there a simpler solution?
- Is this abstraction necessary?
- Can existing code handle this?

## During Development
- Ship working versions early
- Keep commits focused
- Refactor only when patterns are proven

## After Development
- Remove unused code
- Test critical flows
- Review UX polish
- Check responsiveness

---

# Preferred Folder Structure

```
app/
components/
  ui/
  shared/
  features/
lib/
services/
hooks/
types/
```
