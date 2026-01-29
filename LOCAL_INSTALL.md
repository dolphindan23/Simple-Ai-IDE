# SimpleIDE Local Installation Guide

This guide covers how to install and run SimpleIDE on your local machine.

## Prerequisites

- **Node.js 20+** (required for native fetch support)
- **npm** (comes with Node.js)
- **Git** (optional, for cloning)

## Quick Start

### 1. Install Node.js 20+

**macOS (using Homebrew):**
```bash
brew install node@20
```

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:**
Download and install from [nodejs.org](https://nodejs.org/) (LTS version 20+)

**Verify installation:**
```bash
node --version  # Should show v20.x.x or higher
npm --version
```

### 2. Clone or Download the Project

```bash
git clone <repository-url>
cd simpleide
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Application

```bash
npm run dev
```

The application will start on **http://localhost:5000**

## Docker Installation (Optional)

For containerized deployment, use Docker Compose:

### docker-compose.yml

```yaml
version: '3.8'

services:
  simpleide:
    build: .
    ports:
      - "5000:5000"
    volumes:
      - ./workspace:/app/workspace
      - simpleide-data:/app/.simpleide
    environment:
      - NODE_ENV=production
    restart: unless-stopped

volumes:
  simpleide-data:
```

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
```

### Running with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Configuration

### Secrets Vault

SimpleIDE includes an encrypted secrets vault for storing API keys:

1. Open Settings (gear icon)
2. Go to the Security/Vault tab
3. Create a vault with a master password (min 8 characters)
4. Add your API keys:
   - `KAGGLE_API_KEY` - For Kaggle integration
   - `HUGGINGFACE_TOKEN` - For HuggingFace integration
   - `NGC_API_KEY` - For NVIDIA NGC integration

The vault uses AES-256-GCM encryption and is stored in `.simpleide/secrets.enc`

### Ollama (AI Backend)

For AI features, install and configure Ollama:

1. Install Ollama: https://ollama.ai
2. Pull a code model:
   ```bash
   ollama pull codellama
   ```
3. Start Ollama:
   ```bash
   ollama serve
   ```
4. Configure in SimpleIDE Settings > AI tab

## Security Notes

- The secrets vault file (`.simpleide/secrets.enc`) has 0600 permissions (owner read/write only)
- The vault auto-locks after 15 minutes of inactivity (configurable)
- Never commit `.simpleide/secrets.enc` to version control
- Add `.simpleide/` to your `.gitignore`

## Troubleshooting

### Port 5000 in use
```bash
# Find process using port 5000
lsof -i :5000
# Or change port in package.json
```

### Node version too old
```bash
# Use nvm to manage Node versions
nvm install 20
nvm use 20
```

### Permissions issues on secrets file
```bash
# Fix permissions (Unix/macOS)
chmod 600 .simpleide/secrets.enc
chmod 700 .simpleide/
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 5000 |
| NODE_ENV | Environment mode | development |

## License

See LICENSE file in the repository.
