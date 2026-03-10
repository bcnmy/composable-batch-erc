# Contributing

Thank you for your interest in contributing to this ERC. Contributions of all kinds are welcome, including feedback on the specification, improvements to the reference implementation, security analysis, and documentation.

## Ways to Contribute

### Specification Feedback

- Open an issue to discuss ambiguities, edge cases, or potential improvements to the ERC text.
- Propose alternative approaches with a clear rationale and, where possible, supporting examples.
- Review open issues and pull requests to provide your perspective.

### Reference Implementation

- Submit bug fixes or improvements to the reference implementation via pull request.
- Add or improve test cases to increase coverage of edge cases and invariants.
- Report vulnerabilities responsibly by following the security policy below.

### Documentation

- Improve inline documentation, NatSpec comments, or usage examples.
- Help clarify the specification language for precision and readability.

## Getting Started

1. Fork the repository and clone your fork locally.
2. Create a topic branch from `main` for your changes.
3. Install dependencies and run the existing test suite to confirm everything passes before making changes.
4. Make your changes in focused, logically separated commits.
5. Run the full test suite and linter before submitting.

## Pull Request Process

1. Ensure your branch is up to date with `main`.
2. Write a clear PR description that explains **what** changes you made and **why**.
3. Reference any related issues using `Closes #<number>` or `Relates to #<number>`.
4. All CI checks must pass before a PR will be reviewed.
5. At least one maintainer approval is required before merging.
6. Squash commits into a clean history when requested during review.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary>

<optional body>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

## Code Style

- Solidity code must follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html).
- Use NatSpec comments (`@notice`, `@dev`, `@param`, `@return`) for all public and external functions and state variables.
- Keep functions short, focused, and well-named. Prefer clarity over cleverness.

## Reporting Security Vulnerabilities

Do **not** open a public issue for security vulnerabilities. Instead, report them privately by emailing the maintainers or using GitHub's private vulnerability reporting feature on this repository. Include steps to reproduce, potential impact, and any suggested mitigations.

## Discussions and ERC Process

This ERC follows the lifecycle defined by [EIP-1](https://eips.ethereum.org/EIPS/eip-1). Discussion of the standard itself should happen in:

- The **Ethereum Magicians** forum thread linked from the ERC header.
- Issues in this repository tagged with `discussion`.

## License

By contributing, you agree that your contributions will be licensed under the same license as this project.
