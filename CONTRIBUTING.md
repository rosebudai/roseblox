# Contributing to Roseblox

Thank you for your interest in contributing to Roseblox! We welcome contributions from the community and are grateful for any help you can provide.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue on GitHub with the following information:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Browser and OS information
- Code snippets or error messages if applicable

### Suggesting Features

We love hearing ideas for new features! Please create an issue with:

- A clear description of the feature
- Use cases and benefits
- Any implementation ideas you might have

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/roseblox.git
   cd roseblox
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the engine:
   ```bash
   npm run build
   ```
5. Test your changes in the example:
   ```bash
   cd examples/adventure
   python3 -m http.server 8001
   ```

### Pull Request Process

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes following our code style
3. Test your changes thoroughly
4. Commit with clear, descriptive messages
5. Push to your fork and create a pull request
6. Describe your changes in the PR description
7. Link any related issues

### Code Style Guidelines

- Use ES6+ module syntax
- Follow the existing code structure and patterns
- Keep the ECS (Entity-Component-System) architecture in mind
- Document public APIs with JSDoc comments

### Architecture Guidelines

When contributing, please follow these architectural principles:

1. **Engine vs Game Separation**: Core engine functionality belongs in `src/`, game-specific code belongs in examples
2. **ECS with Miniplex**: Use entities, components, and systems appropriately

### Testing

Currently, we're working on adding a comprehensive test suite. When adding new features:

- Consider how it could be tested
- Add examples demonstrating the feature
- Ensure existing examples still work

## Questions?

Feel free to open an issue for any questions about contributing. We're here to help!

## License

By contributing to Roseblox, you agree that your contributions will be licensed under the MIT License.
