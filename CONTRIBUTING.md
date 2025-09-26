# Contributing to PhasePad

Thank you for your interest in contributing to PhasePad! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/PhasePad.git
   cd PhasePad
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the application in development mode:
   ```bash
   npm run dev
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Test thoroughly - ensure all existing features still work
4. Commit with clear, descriptive messages:
   ```bash
   git commit -m "Add: New timer notification sound option"
   ```

### Code Style

- Follow the existing code patterns in the project
- Keep the single-file architecture for `overlay.js` (for now)
- Use meaningful variable and function names
- Add comments for complex logic

### Testing

Currently, PhasePad uses manual testing. Before submitting:
- Test all note types (text, image, timer, todo, etc.)
- Verify workspace switching works
- Check data persistence across restarts
- Test hotkey functionality
- Ensure no console errors

### Submitting Changes

1. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
2. Open a Pull Request on GitHub
3. Describe your changes and why they're needed
4. Link any related issues

## Building for Distribution

### For Contributors (Unsigned Builds)

Contributors can create unsigned builds for testing:
```bash
npm run build
```

### For Maintainers (Signed Builds)

Official releases use code signing. If you're a maintainer:
1. Set up your `.env` file (see `.env.example`)
2. Run the secure build:
   ```bash
   npm run build-safe
   ```

## Project Structure

See [CLAUDE.md](CLAUDE.md) for detailed architecture information.

Key files:
- `main.js` - Electron main process
- `overlay/overlay.js` - All UI and note logic (8000+ lines)
- `overlay/overlay.css` - Styling
- `data/` - User data storage (gitignored)

## Types of Contributions

We welcome:
- Bug fixes
- New note types
- UI/UX improvements
- Performance optimizations
- Documentation improvements
- Translation support (future)

## Reporting Issues

- Use the GitHub Issues tab
- Include your OS version and PhasePad version
- Provide steps to reproduce
- Include error messages if any

## License

By contributing, you agree that your contributions will be licensed under the same [CC-BY-NC-SA-4.0](LICENSE) license as the project.

## Questions?

Feel free to open an issue for discussion or reach out to the maintainers.

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers and help them get started
- Focus on what's best for the community and project