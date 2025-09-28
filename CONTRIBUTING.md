# Contributing to Node.js Photo Manager

Thank you for your interest in contributing to the Node.js Photo Manager project! This document provides guidelines and principles to follow when contributing code.

## Core Architectural Principles

### 1. Unified View Context

**IMPORTANT: There is NO conceptual distinction between "All Photos" and "Project" views.**

A Project view is simply the All Photos view with a project filter applied. This is a fundamental architectural principle that must be maintained throughout the codebase.

#### Implementation Guidelines:

- Use `view.project_filter` (null = All Photos, string = specific project) to determine the current view context
- Use the unified selection model with `PhotoRef` objects
- Use unified modal states for consistent behavior
- Avoid branching based on "mode" flags

#### Anti-patterns to Avoid:

- Adding new code that branches on `isAllMode` or similar flags
- Creating separate handlers for All Photos vs Project views
- Duplicating logic that should be shared between views
- Creating separate UI components for functionally identical features

### 2. Modular Architecture

The codebase follows a modular architecture with specialized React hooks and services:

- **Hooks**: Focus on specific functionality and follow React best practices
- **Services**: Encapsulate business logic independent of UI concerns
- **Components**: Reusable UI elements that receive data and callbacks as props

### 3. Code Quality Standards

- Write comprehensive JSDoc comments for functions and types
- Follow consistent naming conventions
- Ensure proper dependency arrays in React hooks
- Implement proper cleanup functions for effects
- Write tests for critical functionality

## Pull Request Guidelines

1. **Scope**: Keep PRs focused on a single issue or feature
2. **Tests**: Include tests for new functionality
3. **Documentation**: Update relevant documentation
4. **Compatibility**: Ensure backward compatibility or document breaking changes
5. **Review**: Address all review comments before merging

## Development Workflow

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Run tests and linting
5. Submit a pull request

## Code Review Checklist

- [ ] Code follows architectural principles
- [ ] No unnecessary mode-specific branching
- [ ] Proper error handling
- [ ] Consistent naming conventions
- [ ] Comprehensive documentation
- [ ] Tests included
- [ ] No performance regressions

Thank you for helping improve the Node.js Photo Manager!
