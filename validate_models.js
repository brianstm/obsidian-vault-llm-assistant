const https = require('https');
const readline = require('readline');
const { OPENAI_MODELS, GEMINI_MODELS } = require('./models');

// ANSI colors for output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m"
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function validateOpenAI(apiKey) {
    console.log(`\n${colors.cyan}--- Validating OpenAI Models ---${colors.reset}`);

    for (const modelObj of OPENAI_MODELS) {
        const model = modelObj.id;
        process.stdout.write(`Testing ${model.padEnd(20)} ... `);

        try {
            const endpoint = modelObj.endpoint || '/v1/chat/completions';
            const messages = [{ role: "user", content: "Hi" }];
            const maxTokens = 50; // Increased to 50 to avoid length errors

            let body = {
                model: model,
            };

            if (endpoint === "/v1/responses") {
                body.input = messages;
            } else if (endpoint === "/v1/completions") {
                body.prompt = "Hi";
            } else {
                body.messages = messages;
            }

            if (modelObj.useMaxCompletionTokens) {
                body.max_completion_tokens = maxTokens;
            } else if (endpoint !== "/v1/responses") {
                // v1/responses does not support max_tokens at the top level in this context
                body.max_tokens = maxTokens;
            }

            await new Promise((resolve, reject) => {
                const req = https.request('https://api.openai.com' + endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    }
                }, res => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve();
                        } else {
                            try {
                                const err = JSON.parse(data);
                                reject(new Error(err.error?.message || `Status ${res.statusCode}`));
                            } catch (e) {
                                reject(new Error(`Status ${res.statusCode}`));
                            }
                        }
                    });
                });

                req.on('error', reject);

                req.write(JSON.stringify(body));
                req.end();
            });
            console.log(`${colors.green}OK${colors.reset}`);
        } catch (error) {
            console.log(`${colors.red}FAILED${colors.reset} (${error.message})`);
        }
    }
}

async function validateGemini(apiKey) {
    console.log(`\n${colors.cyan}--- Validating Gemini Models ---${colors.reset}`);

    for (const modelObj of GEMINI_MODELS) {
        const model = modelObj.id;
        process.stdout.write(`Testing ${model.padEnd(25)} ... `);

        try {
            await new Promise((resolve, reject) => {
                const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }, res => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            const response = JSON.parse(data);
                             if (response.error) {
                                reject(new Error(response.error.message));
                            } else {
                                resolve();
                            }
                        } else {
                             try {
                                const err = JSON.parse(data);
                                reject(new Error(err.error?.message || `Status ${res.statusCode}`));
                            } catch (e) {
                                reject(new Error(`Status ${res.statusCode}`));
                            }
                        }
                    });
                });

                req.on('error', reject);

                req.write(JSON.stringify({
                    contents: [{ parts: [{ text: "Hi" }] }],
                    generationConfig: { maxOutputTokens: 1 }
                }));
                req.end();
            });
            console.log(`${colors.green}OK${colors.reset}`);
        } catch (error) {
            console.log(`${colors.red}FAILED${colors.reset} (${error.message})`);
        }
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--openai' && args[i+1]) {
            parsed.openai = args[i+1];
            i++;
        } else if (args[i] === '--gemini' && args[i+1]) {
            parsed.gemini = args[i+1];
            i++;
        }
    }
    return parsed;
}

async function main() {
    console.log(`${colors.yellow}Vault LLM Assistant - Model Validator${colors.reset}\n`);
    const args = parseArgs();

    // Check if any args were provided to skip prompts
    const hasArgs = args.openai || args.gemini;

    if (!hasArgs) {
        console.log("This script will test the availability of the models defined in the plugin.");
        console.log("You will need valid API keys for OpenAI and/or Google Gemini.\n");
        console.log("Usage with args: node validate_models.js --openai KEY --gemini KEY\n");
    }

    // OpenAI Validation
    if (args.openai) {
        await validateOpenAI(args.openai);
    } else if (!hasArgs) {
        const checkOpenAI = await prompt("Validate OpenAI models? (y/n): ");
        if (checkOpenAI.toLowerCase() === 'y') {
            const apiKey = await prompt("Enter OpenAI API Key: ");
            if (apiKey) {
                await validateOpenAI(apiKey.trim());
            } else {
                console.log("Skipping due to missing API Key.");
            }
        }
    }

    // Gemini Validation
    if (args.gemini) {
        await validateGemini(args.gemini);
    } else if (!hasArgs) {
        const checkGemini = await prompt("\nValidate Gemini models? (y/n): ");
        if (checkGemini.toLowerCase() === 'y') {
            const apiKey = await prompt("Enter Gemini API Key: ");
            if (apiKey) {
                await validateGemini(apiKey.trim());
            } else {
                console.log("Skipping due to missing API Key.");
            }
        }
    }

    console.log(`\n${colors.yellow}Validation Complete.${colors.reset}`);
    rl.close();
}

main();
