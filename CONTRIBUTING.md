# Contributing to MCP Bridge

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/mahawi1992/mwilliams_mcpbridge.git
cd mwilliams_mcpbridge
npm install
```

## Running Locally

```bash
# Start the bridge server
node bridge-server.js

# In another terminal, run tests
node test-client.js
```

## Adding a New Default Server

1. Edit `bridge-server.js` and add to the default `SERVERS` object:

```javascript
'my-server': {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@org/my-mcp-server@latest'],
  description: 'What this server does',
  enabled: true
}
```

2. Update the README with the new server
3. Add an example to `mcpbridge.config.example.json`
4. Test with `node test-client.js list-tools my-server`

## Pull Request Guidelines

1. Fork the repo and create a branch from `main`
2. Test your changes with `node test-client.js`
3. Update documentation if needed
4. Submit a PR with a clear description

## Code Style

- Use ES modules (`import`/`export`)
- Use async/await for async operations
- Add JSDoc comments for public functions
- Keep error messages helpful

## Reporting Issues

When reporting issues, please include:
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Error messages (full stack trace if available)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
