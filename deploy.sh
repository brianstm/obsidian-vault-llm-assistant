#!/bin/bash

VAULT_PLUGIN_PATH="/mnt/c/Users/Gabriel Dutra/Documents/Obsidian Vault/.obsidian/plugins/obsidian-vault-llm-assistant"

echo "Building plugin..."
npm run build

echo "Deploying to: $VAULT_PLUGIN_PATH"

# Remove existing plugin folder
if [ -d "$VAULT_PLUGIN_PATH" ]; then
    echo "Removing existing plugin folder..."
    rm -r "$VAULT_PLUGIN_PATH"
fi

# Create plugin folder
echo "Creating plugin folder..."
mkdir -p "$VAULT_PLUGIN_PATH"

# Copy files
echo "Copying files..."
cp main.js manifest.json styles.css "$VAULT_PLUGIN_PATH/"

echo "Deployment complete!"
