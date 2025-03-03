import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import dotenv from "dotenv";
import { Metaplex, token } from "@metaplex-foundation/js";
import pkg from "@metaplex-foundation/mpl-auction-house";
import { Connection, PublicKey } from "@solana/web3.js";
import { ENV, TokenListProvider } from "@solana/spl-token-registry";
import fs from 'fs';

dotenv.config();

const { AuthorityScope } = pkg;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Periodically check for all-time high every 60 seconds
const CHECK_INTERVAL = 60000; // 60 secs
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BOT_IMAGE_URL = process.env.BOT_IMAGE_URL;
const ICON_IMAGE_URL = process.env.ICON_IMAGE_URL;
const ALERT_CHANNEL_ID = "1275427179617980426";
const ITEMS_PER_PAGE = 5; // Set how many users to show per page

const rpcEndpoints = [
    "https://api.mainnet-beta.solana.com", // Default Solana RPC
    "https://solana-mainnet.g.alchemy.com/v2/uZc2ECufKP3skEMrS8DiE5AeBRVHkyB8", // Alchrmy RPC
    "https://va.sharknode.xyz/ ", // Default Solana RPC
    // Add more endpoints if necessary
];


const EXCLUDED_BOT_ID = [
    "1270155497911095337",
    "1270148826694549505",
    "1270462498562375823",
    "1269735196802940960",
    "1270139028318064691",
    "1270471392571297845",
    "1270475554612838432",
    "1269782311533281281",
];

const MONITORED_CHANNEL_IDS = [
    '1272391061410549854',
    '1276696227181760512',
    '1268746586138214483',
    '1268713766317723822',
    '1268746136269754499',
    '1268746365744447560',
    '1268713939965837453',
    '1268747183046525070',
    '1268714226734727189',
    '1268746243325169674',
    '1268746304205619230',
    '1268746980943990838',
    '1268747528086622219',
    '1268746833698623589',
    '1268746431624380509',
    '1268747260007682068',
    '1268746488327045252',
    '1268746921074229279'
];

let caTracker = loadCaTrackerFromFile();
const userCallCounts = {}; // To track the number of calls per user
let rpcIndex = 0;

// Helper function to format market cap
function formatMarketCap(marketCap) {
    if (marketCap >= 1e9) {
        return (marketCap / 1e9).toFixed(2) + "B";
    } else if (marketCap >= 1e6) {
        return (marketCap / 1e6).toFixed(2) + "M";
    } else if (marketCap >= 1e3) {
        return (marketCap / 1e3).toFixed(2) + "K";
    } else if (marketCap > 0) {
        return marketCap.toFixed(2);
    } else {
        return null;
    }
}

function transformValue(value) {
    if (typeof value === "string" && value.trim() !== "") {
        const trimmedValue = value.trim();
        const lastChar = trimmedValue.slice(-1).toUpperCase();
        const numericPart = parseFloat(trimmedValue.slice(0, -1).replace(",", ""));

        if (["K", "M", "B"].includes(lastChar)) {
            switch (lastChar) {
                case "K":
                    return numericPart * 1e3;
                case "M":
                    return numericPart * 1e6;
                case "B":
                    return numericPart * 1e9;
            }
        }
    }
    return null;
}

function isValidPublicKey(key) {
    try {
        new PublicKey(key);
        return true;
    } catch (e) {
        return false;
    }
}

// Function to rotate the rpc endpoint and rotate to the next one
function getRandomRpcEndpoint() {
    const randomIndex = Math.floor(Math.random() * rpcEndpoints.length);
    return rpcEndpoints[randomIndex];
}

// Example function to create a connection using the next available RPC
function createConnection() {
    const rpcUrl = getRandomRpcEndpoint();
    console.log(`Using RPC at Random: ${rpcUrl}`)
    return new Connection(rpcUrl, 'confirmed'); // Adjust commitment level if needed
}

async function getTokenPrice(mintAddress, retries = 3, delay = 2000) {
    let attempt = 0;

    while (attempt < retries) {
        try {
            const response = await fetch(
                `https://api-v3.raydium.io/mint/price?mints=${mintAddress}`,
                { timeout: 10000 }
            ); // 10 seconds timeout
            const responseData = await response.json();

            if (responseData.success && responseData.data) {
                const tokenPrice = responseData.data[mintAddress];
                return tokenPrice ? parseFloat(tokenPrice) : null;
            }
        } catch (error) {
            if (error.code === "UND_ERR_CONNECT_TIMEOUT") {
                console.error(`Connection timed out on attempt ${attempt + 1}. Retrying...`);
            } else {
                console.error("Error fetching token price:", error);
            }

            attempt++;

            if (attempt < retries) {
                const backoffDelay = delay * Math.pow(2, attempt);
                console.log(`Retrying in ${backoffDelay / 1000} seconds...`);
                await new Promise(res => setTimeout(res, backoffDelay));
            }
        }
    }

    console.error(`Failed to fetch token price of ${tokenSymbol} after ${retries} attempts.`);
    return null;
}

async function getTokenSupply(connection, mintAddress) {
    const mintInfo = await connection.getParsedAccountInfo(mintAddress);
    if (mintInfo.value && mintInfo.value.data) {
        const supply = mintInfo.value.data.parsed.info.supply;
        return parseFloat(supply) / 10 ** mintInfo.value.data.parsed.info.decimals;
    }

    return null;
}

function getEmojiForWinRate(winRate) {
    if (winRate >= 80) {
        return "🏆"; // Trophy emoji for very high win rates
    } else if (winRate >= 60) {
        return "🥇"; // Gold medal emoji for high win rates
    } else if (winRate >= 40) {
        return "🥈"; // Silver medal emoji for medium win rates
    } else if (winRate >= 20) {
        return "🥉"; // Bronze medal emoji for lower win rates
    } else {
        return "❌"; // Cross emoji for very low win rates
    }
}

function getEmojiForRoi(roi) {
    if (roi >= 50) {
        return "🚀"; // Rocket emoji for very high ROI
    } else if (roi >= 20) {
        return "📈"; // Chart emoji for good ROI
    } else if (roi >= 0) {
        return "📊"; // Bar chart emoji for positive ROI
    } else {
        return "📉"; // Downward trend emoji for negative ROI
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to get metadata for a token using PumpFun API with retry logic
async function getPumpFunTokenMetadata(ca, retries = 3, delay = 1000) {
    const url = `https://frontend-api.pump.fun/coins/${ca}`;

    for (let attempt = 1; attempt <= retries; attempt++) {

        let tokenName = '❌';
        let tokenSymbol = '❌';
        let tokenDesc = '❌';
        let tokenLogo = BOT_IMAGE_URL;  // Default value for tokenLogo
        let tokenX = '❌';
        let tokenTg = '❌';
        let tokenWeb = '❌';
        let created_timestamp = '❌';
        let raydium_pool = '❌';
        let isTradingOn = '❌';
        let usd_market_cap = '❌';
        let exchangeValue = '❌';
        let formattedMarketCap = '❌';

        try {
            // console.log(`Attempt ${attempt} to fetch token metadata...`);

            const response = await fetch(url);

            // Check if response is okay
            if (!response.ok) {
                throw new Error(`Error fetching token metadata: ${response.statusText}`);
            }

            // Parse response JSON
            const data = await response.json();

            tokenX = data.twitter || '❌';
            tokenTg = data.telegram || '❌';
            tokenWeb = data.website || '❌';
            tokenName = data.name || '❌';
            tokenLogo = data.image_uri || BOT_IMAGE_URL;
            tokenSymbol = data.symbol || '❌';

            tokenDesc = data.description || '❌';
            created_timestamp = data.created_timestamp || '❌';
            raydium_pool = data.raydium_pool || '❌';
            usd_market_cap = data.usd_market_cap || '❌';
            formattedMarketCap = formatMarketCap(data.usd_market_cap)

            if (data.raydium_pool === null) {
                isTradingOn = 'Token is live on PumpFun only';
                exchangeValue = `[PumpFun](https://pump.fun/${ca})`; // Default exchange value

            } else {
                isTradingOn = 'Token is already live on Raydium';
                exchangeValue = `[Raydium](https://raydium.io/swap/?outputMint=${ca}&inputMint=sol)`; // Default exchange value
            }

            // Log and return the metadata
            // console.log('Token Metadata:', data);

            // Return the metadata and whether the token was created on PumpFun
            return {
                tokenName,
                tokenSymbol,
                tokenLogo,
                tokenDesc,
                tokenX,
                tokenTg,
                tokenWeb,
                formattedMarketCap,
                exchangeValue,
                raydium_pool,
                isTradingOn,
            };
        } catch (error) {
            console.error(`Attempt ${attempt} failed: ${error.message}`);

            // If we've reached the maximum number of retries, throw the error
            if (attempt === retries) {
                console.error('Max retries reached. Exiting.');
                throw error;
            }

            // Wait for a delay before retrying (exponential backoff: delay * 2^attempt)
            const backoffDelay = delay * Math.pow(2, attempt);
            //   console.log(`Retrying in ${backoffDelay / 1000} seconds...`);
            await sleep(backoffDelay);
        }
    }
}

async function getTokenMetadata(ca, retries = 3, delay = 2000) {
    //   console.log("Fetching token metadata...");
    const connection = new Connection("https://va.sharknode.xyz/", 'confirmed');
    // const connection = createConnection(); // Use rotating RPC endpoints
    const metaplex = Metaplex.make(connection);
    const mintAddress = new PublicKey(ca);

    let tokenName = '❌';
    let tokenSymbol = '❌';
    let tokenLogo = '❌';
    let tokenDesc = '❌';
    let tokenX = '❌';
    let tokenTg = '❌';
    let tokenWeb = '❌';
    let isCreatedOnPumpfun = '❌';
    let formattedMarketCap = '❌';
    let exchangeValue = '❌'; // Default exchange value

    let attempt = 0;

    while (attempt < retries) {
        try {
            const metadataAccount = metaplex.nfts().pdas().metadata({ mint: mintAddress });
            const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);

            if (metadataAccountInfo) {
                const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });

                if (token.json?.createdOn === 'https://pump.fun') {
                    isCreatedOnPumpfun = 'Token is created on PumpFun';
                    const pumpFunMetadata = await getPumpFunTokenMetadata(mintAddress.toBase58());
                    return { ...pumpFunMetadata };

                } else {

                    tokenName = token.name;
                    tokenSymbol = token.symbol;
                    tokenLogo = token.json?.image;
                    tokenDesc = token.json?.description;
                    tokenX = token.json?.twitter || '❌';
                    tokenTg = token.json?.telegram || '❌';
                    tokenWeb = token.json?.website || '❌';

                    isCreatedOnPumpfun = 'Token is not created on PumpFun';
                    exchangeValue = `[Raydium](https://raydium.io/swap/?outputMint=${ca}&inputMint=sol)`; // Default exchange value

                    const tokenPrice = await getTokenPrice(mintAddress.toBase58());
                    const tokenSupply = await getTokenSupply(connection, mintAddress);

                    // console.log("tokenPrice", tokenPrice)
                    // console.log("tokenSupply", tokenSupply)

                    if (tokenPrice !== null && tokenSupply !== null) {
                        const marketCapV = tokenPrice * tokenSupply;
                        formattedMarketCap = formatMarketCap(marketCapV);
                    } else {
                        console.error("Token Price or Supply: Not available");
                    }
                }

            } else {
                const provider = await new TokenListProvider().resolve();
                const tokenList = provider.filterByChainId(ENV.MainnetBeta).getList();
                const tokenMap = tokenList.reduce((map, item) => {
                    map.set(item.address, item);
                    return map;
                }, new Map());

                const token = tokenMap.get(mintAddress.toBase58());
                if (token) {
                    tokenName = token.name;
                    tokenSymbol = token.symbol;
                    tokenLogo = token.logoURI;
                    tokenDesc = token.description || 'No description available';
                    tokenX = token.twitter || '❌';
                    tokenTg = token.telegram || '❌';
                    tokenWeb = token.website || '❌';

                    const tokenPrice = await getTokenPrice(mintAddress.toBase58());
                    const tokenSupply = await getTokenSupply(connection, mintAddress);

                    if (tokenPrice !== null && tokenSupply !== null) {
                        const marketCapV = tokenPrice * tokenSupply;
                        formattedMarketCap = formatMarketCap(marketCapV);
                    } else {
                        console.error("Token Price or Supply: Not available");
                    }
                }
            }
        } catch (error) {
            console.error("Error fetching token metadata:", error);
        }

        attempt++;

        if (attempt < retries) {
            await new Promise(res => setTimeout(res, delay)); // Delay before retrying
        }
    }

    if (attempt === retries) {
        console.error(`Failed to fetch token metadata of ${tokenSymbol} after ${retries} attempts.`);
    }

    return {
        tokenName,
        tokenSymbol,
        tokenLogo,
        tokenDesc,
        tokenX,
        tokenTg,
        tokenWeb,
        formattedMarketCap,
        exchangeValue,
        isCreatedOnPumpfun, // exempted
    };
}

async function checkAllTimeHighs() {
    const alertChannel = client.channels.cache.get(ALERT_CHANNEL_ID);

    if (!alertChannel) {
        console.error(`Alert channel with ID ${ALERT_CHANNEL_ID} not found.`);
        return;
    }

    for (const ca of Object.keys(caTracker)) {
        const { formattedMarketCap } = await getTokenMetadata(ca);

        if (formattedMarketCap === null || formattedMarketCap === undefined || formattedMarketCap === '❌') {
            console.log(`Incomplete MC data for token ${ca}: ATH is ${formattedMarketCap}`);
            delete caTracker[ca];
            continue; // Skip to the next iteration
        }

        const username = caTracker[ca][0].username;
        const userId = caTracker[ca][0].userId; // Retrieve the user ID from caTracker
        const usernameMention = `<@${userId}>`;
        const tokenSymbol = caTracker[ca][0].tokenSymbol;

        // Store the market cap at the time of the call if it doesn't exist
        if (!caTracker[ca].initialMarketCap) {
            caTracker[ca].initialMarketCap = formattedMarketCap;
            saveCaTrackerToFile()
        }

        // Initialize allTimeHigh with the initial market cap if not already set
        if (!caTracker[ca].allTimeHigh) {
            caTracker[ca].allTimeHigh = caTracker[ca].initialMarketCap;
            saveCaTrackerToFile()
        }

        const initialMarketCap = caTracker[ca].initialMarketCap;

        // Calculate ROI whenever the market cap changes
        if (formattedMarketCap > caTracker[ca].allTimeHigh && formattedMarketCap > initialMarketCap) {
            caTracker[ca].allTimeHigh = formattedMarketCap;

            // Update ROI calculation after setting new ATH
            const allTimeHighRoi = transformValue(caTracker[ca].allTimeHigh);
            const initialMarketCapRoi = transformValue(initialMarketCap);
            const newRoi =
                ((allTimeHighRoi - initialMarketCapRoi) / initialMarketCapRoi) * 100;
            caTracker[ca][0].roi = newRoi.toFixed(2);

            // Determine if it's a win: ROI must be greater than 0%
            if (newRoi > 0) {
                caTracker[ca][0].isWin = true;
            } else {
                caTracker[ca][0].isWin = false; // Mark it as a loss if ROI is negative
            }

        } else {
            console.log(
                `${tokenSymbol} of ${formattedMarketCap} MC did not pass ATH of ${caTracker[ca].allTimeHigh}`
            );
        }
        saveCaTrackerToFile();
        console.log("-------------------------------");
    }
}

function saveCaTrackerToFile() {
    try {
        const data = JSON.stringify(caTracker, null, 2);
        fs.writeFileSync('caTracker.json', data);
    } catch (error) {
        console.error('Error saving caTracker to file:', error);
    }
}

function loadCaTrackerFromFile() {
    try {
        if (fs.existsSync('caTracker.json')) {
            const data = fs.readFileSync('caTracker.json');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading caTracker from file:', error);
    }
    return {}; // Return an empty object if the file doesn't exist or there's an error
}

async function checkAndSendAlert(ca) {
    const alertChannel = client.channels.cache.get(ALERT_CHANNEL_ID);

    if (!alertChannel) {
        console.error(`Alert channel with ID ${ALERT_CHANNEL_ID} not found.`);
        return;
    }

    const { tokenName, tokenSymbol, tokenLogo, formattedMarketCap, exchangeValue } =
        await getTokenMetadata(ca);

    const isIncomplete = !tokenName || !tokenSymbol || formattedMarketCap === null || formattedMarketCap === undefined || formattedMarketCap === '❌';

    caTracker[ca][0].tokenName = tokenName;
    caTracker[ca][0].tokenSymbol = tokenSymbol;

    if (isIncomplete) {
        console.log(`Incomplete data for token ${ca}: marketCap is ${formattedMarketCap}`);
        delete caTracker[ca];
        return; // Exit early if data is incomplete
    } else {
        const channelMentions = caTracker[ca].reduce((acc, entry) => {
            if (!acc[entry.channelId]) {
                acc[entry.channelId] = { count: 0, messages: [] };
            }
            acc[entry.channelId].count++;
            acc[entry.channelId].messages.push(
                `[Message tracked at <t:${Math.floor(entry.timestamp / 1000)}:T>](${entry.messageLink
                }) by ${entry.username}`
            );
            return acc;
        }, {});

        const username = caTracker[ca][0].username;
        const userId = caTracker[ca][0].userId; // Retrieve the user ID from caTracker
        const usernameMention = `<@${userId}>`;

        // Increment the user's call count
        if (!userCallCounts[username]) {
            userCallCounts[username] = 0;
        }
        userCallCounts[username] += 1;

        console.log(`${username} has made ${userCallCounts[username]} token calls`);

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${username} called ${tokenSymbol} at $${formattedMarketCap}`)
            .setThumbnail(tokenLogo || BOT_IMAGE_URL)
            .addFields(
                {
                    name: "Caller Profile",
                    value: `${username}`,
                    inline: true,
                },
                {
                    name: "Chart",
                    value: `[Dexscreener](https://dexscreener.com/search?q=${ca})`,
                    inline: true,
                },
                { name: 'Quick Trade', value: `[BullX](https://bullx.io/terminal?chainId=1399811149&address=${ca}) | [Photon](https://photon-sol.tinyastro.io/en/lp/${ca}?handle=6276553ddaa3fa5705a3a)`, inline: false },
                { name: "Token Address / CA", value: `\`${ca}\``, inline: false },
                { name: "MCAP", value: formattedMarketCap.toString() || "NA", inline: true },
                { name: "EXCHANGE", value: exchangeValue, inline: true }
            )
            .setTimestamp()
            .setFooter({ iconURL: ICON_IMAGE_URL, text: 'ConclavioØX' });

        for (const [channelId, details] of Object.entries(channelMentions)) {
            const channel = client.channels.cache.get(channelId);
            const channelName = channel ? channel.name : "Unknown Channel";
            embed.addFields({
                name: `${channelName} called ${details.count} times`,
                value: details.messages.join("\n"),
                inline: false,
            });
        }
        saveCaTrackerToFile();
        alertChannel.send({ embeds: [embed] });
    }
}

client.on("messageCreate", async (message) => {
    if (message.author.id === client.user.id) return;
    if (EXCLUDED_BOT_ID.includes(message.author.id)) return;
    if (!MONITORED_CHANNEL_IDS.includes(message.channel.id)) return;

    const content = message.content;
    const regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/g;

    const alertChannel = client.channels.cache.get(ALERT_CHANNEL_ID);

    if (!alertChannel) {
        console.error(`Alert channel with ID ${ALERT_CHANNEL_ID} not found.`);
        return;
    }

    if (content.startsWith("!top")) {
        // Collect performance data for each user
        const userPerformance = {};

        for (const ca in caTracker) {
            const username = caTracker[ca][0].username;
            if (!userPerformance[username]) {
                userPerformance[username] = {
                    wins: 0,
                    losses: 0,
                    roiSum: 0,
                    roiCount: 0,
                    callDetails: [],
                    roiDetails: [],
                    groupDetails: new Set(),
                };
            }

            const entry = caTracker[ca][0];
            if (entry.isWin) userPerformance[username].wins++;
            else userPerformance[username].losses++;

            if (entry.roi !== null) {
                userPerformance[username].roiSum += parseFloat(entry.roi);
                userPerformance[username].roiCount++;
            }

            userPerformance[username].callDetails.push({
                tokenSymbol: entry.tokenSymbol || "Unknown",
                roi: entry.roi || "0",
                timestamp: entry.timestamp,
            });

            userPerformance[username].roiDetails.push({
                tokenSymbol: entry.tokenSymbol || "Unknown",
                roi: entry.roi || "0",
                timestamp: entry.timestamp,
            });

            userPerformance[username].groupDetails.add(entry.channelId);
        }

        // Sort users by win rate
        const sortedUsers = Object.entries(userPerformance).sort(([, a], [, b]) => {
            const winRateA = a.wins + a.losses > 0 ? (a.wins / (a.wins + a.losses)) * 100 : 0;
            const winRateB = b.wins + b.losses > 0 ? (b.wins / (b.wins + b.losses)) * 100 : 0;
            return winRateB - winRateA;
        });

        let page = 0;

        // Function to generate embed content for the current page
        const generateEmbed = () => {
            const embed = new EmbedBuilder()
                .setTitle("User Information - Page " + (page + 1))
                .setColor("#3498db")
                .setDescription(`Details of all users in caTracker, ranked by win rate (Page ${page + 1}):`)
                .setFooter({ iconURL: ICON_IMAGE_URL, text: 'ConclavioØX' });

            const start = page * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            const usersToShow = sortedUsers.slice(start, end);

            usersToShow.forEach(([username, data], index) => {
                const winRate = data.wins + data.losses > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(2) : 0;
                const avgRoi = data.roiCount > 0 ? (data.roiSum / data.roiCount).toFixed(2) : "0";

                // Format the call details and group details
                data.callDetails.sort((a, b) => b.timestamp - a.timestamp);
                data.roiDetails.sort((a, b) => b.roi - a.roi);

                const formattedRoiDetails = data.roiDetails.map(({ tokenSymbol, roi }) => `${tokenSymbol} \`${roi}%\``);
                const formattedCallDetails = data.callDetails.slice(0, 3).map(({ tokenSymbol, roi }) => `${tokenSymbol} \`${roi}%\``);

                const formattedGroupDetails = [...data.groupDetails].map((channelId) => {
                    const channel = client.channels.cache.get(channelId);
                    return channel ? channel.name : `Unknown Channel (${channelId})`;
                });

                // Add fields to embed in rows with bold headers
                embed.addFields(
                    {
                        name: `**#${start + index + 1}. ${username}**`,
                        value: `Winrate: \`${winRate}%\` ${getEmojiForWinRate(winRate)} | Avg ROI: \`${avgRoi}%\` ${getEmojiForRoi(avgRoi)}\n` +
                            `Wins: \`${data.wins}\` | Losses: \`${data.losses}\` | Total Calls: \`${data.wins + data.losses}\``,
                        inline: false,
                    },
                    { name: '**Tokens Called and ROIs:**', value: formattedRoiDetails.join("\n") || "None", inline: true },
                    { name: '**Most Recent Calls:**', value: formattedCallDetails.join("\n") || "None", inline: true },
                    { name: '**Groups:**', value: formattedGroupDetails.join("\n") || "None", inline: true }
                );
            });

            return embed;
        };

        // Send the first page
        const embedMessage = await alertChannel.send({ embeds: [generateEmbed()] });

        // Add reaction for pagination
        await embedMessage.react('⬅️');
        await embedMessage.react('➡️');

        const filter = (reaction, user) => {
            return ['⬅️', '➡️'].includes(reaction.emoji.name) && user.id === message.author.id;
        };

        const collector = embedMessage.createReactionCollector({ filter, time: 60000 });

        collector.on('collect', (reaction, user) => {
            if (reaction.emoji.name === '⬅️' && page > 0) {
                page--;
            } else if (reaction.emoji.name === '➡️' && (page + 1) * ITEMS_PER_PAGE < sortedUsers.length) {
                page++;
            }

            embedMessage.edit({ embeds: [generateEmbed()] });
            reaction.users.remove(user.id); // Remove the user's reaction to allow for more interaction
        });
    }

    if (content.startsWith("!perf")) {
        // console.log("!performance command received");

        const embed = new EmbedBuilder()
            .setTitle("User Information")
            .setColor("#3498db")
            .setDescription("Here are your details:")
            .setFooter({ iconURL: ICON_IMAGE_URL, text: 'ConclavioØX' });

        const username = message.author.username;
        let roiDetails = [];
        let callDetails = [];
        let groupDetails = new Set(); // Using a Set to avoid duplicate channels
        let totalRoiSum = 0; // To sum up all ROIs
        let totalRoiCount = 0; // To count all valid ROIs
        let wins = 0;
        let losses = 0;

        for (const ca in caTracker) {
            if (caTracker[ca][0].username === username) {
                const tokenSymbol = caTracker[ca][0].tokenSymbol || "Unknown";
                const roi = caTracker[ca][0].roi !== null ? parseFloat(caTracker[ca][0].roi) : 0;
                const timestamp = caTracker[ca][0].timestamp;
                const channelId = caTracker[ca][0].channelId;
                const isWin = caTracker[ca][0].isWin;

                if (isWin) wins++;
                else losses++;

                // Only push if ROI is a number
                roiDetails.push({ tokenSymbol, roi });
                totalRoiSum += roi; // Add ROI to total sum
                totalRoiCount++; // Increment count of valid ROIs

                // Add tokenSymbol and timestamp to callDetails
                callDetails.push({ tokenSymbol, roi, timestamp });

                // Collect unique channel IDs
                groupDetails.add(channelId);
            }
        }

        // Calculate average ROI if there are any valid ROIs
        const averageRoi = totalRoiCount > 0 ? (totalRoiSum / totalRoiCount).toFixed(2) : "0";
        // Calculate win rate
        const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(2) : "0";

        // Format the call details and group details
        callDetails.sort((a, b) => b.timestamp - a.timestamp);
        const lastThreeCalls = callDetails.slice(0, 3);

        // Format the last three call details into strings
        const formattedCallDetails = lastThreeCalls.map(
            ({ tokenSymbol, roi }, index) =>
                `${index + 1}. ${tokenSymbol} \`${roi}%\``
        );

        // Sort roiDetails by ROI in descending order and format into strings
        roiDetails.sort((a, b) => b.roi - a.roi);
        const formattedRoiDetails = roiDetails.map(
            ({ tokenSymbol, roi }, index) =>
                `${index + 1}. ${tokenSymbol} \`${roi}%\``
        );

        const formattedGroupDetails = [...groupDetails]
            .map((channelId) => {
                const channel = client.channels.cache.get(channelId);
                return channel
                    ? `• ${channel.name} (${channelId})`
                    : `• Unknown Channel (${channelId})`;
            })
            .join("\n");

        // Add user performance summary to embed
        embed.addFields(
            {
                name: `**${username}**`,
                value: `Winrate: \`${winRate}%\` ${getEmojiForWinRate(winRate)} | Avg ROI: \`${averageRoi}%\` ${getEmojiForRoi(averageRoi)}\n` +
                    `Wins: \`${wins}\` | Losses: \`${losses}\` | Total Calls: \`${wins + losses}\``,
                inline: false,
            },
            { name: '**Tokens Called and ROIs**', value: formattedRoiDetails.join("\n") || "None", inline: true },
            { name: '**Most Recent Calls**', value: formattedCallDetails.join("\n") || "None", inline: true },
            { name: '**Groups**', value: formattedGroupDetails || "None", inline: true }
        );

        // Send the embed to the alert channel
        alertChannel.send({ embeds: [embed] });
    }

    if (content.startsWith("!info")) {
        const users = message.mentions.users;

        if (users.size > 0) {
            // Create a new embed
            const embed = new EmbedBuilder()
                .setTitle("User Information")
                .setColor("#3498db")
                .setDescription("Here are the details of the mentioned users:")
                .setFooter({ iconURL: ICON_IMAGE_URL, text: 'ConclavioØX' });

            // Iterate through each mentioned user
            users.forEach((user) => {
                const username = user.username;
                // console.log(`!info command received from ${username}`);

                // Collect all token symbols and ROIs for the user
                let roiDetails = [];
                let callDetails = [];
                let groupDetails = new Set(); // Using a Set to avoid duplicate channels
                let totalRoiSum = 0; // To sum up all ROIs
                let totalRoiCount = 0; // To count all valid ROIs
                let wins = 0;
                let losses = 0;

                for (const ca in caTracker) {
                    if (caTracker[ca][0].username === username) {
                        const tokenSymbol = caTracker[ca][0].tokenSymbol || "Unknown";
                        const roi =
                            caTracker[ca][0].roi !== null
                                ? parseFloat(caTracker[ca][0].roi)
                                : 0;
                        const timestamp = caTracker[ca][0].timestamp;
                        const channelId = caTracker[ca][0].channelId;
                        const isWin = caTracker[ca][0].isWin;

                        if (isWin) wins++;
                        else losses++;

                        // Only push if ROI is a number
                        roiDetails.push({ tokenSymbol, roi });
                        totalRoiSum += roi; // Add ROI to total sum
                        totalRoiCount++; // Increment count of valid ROIs

                        // Add tokenSymbol and timestamp to callDetails
                        callDetails.push({ tokenSymbol, roi, timestamp });

                        // Collect unique channel IDs
                        groupDetails.add(channelId);
                    }
                }

                // Calculate average ROI if there are any valid ROIs
                const averageRoi = totalRoiCount > 0 ? (totalRoiSum / totalRoiCount).toFixed(2) : "0";
                // Calculate win rate
                const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(2) : "0";

                // Format the call details and group details
                callDetails.sort((a, b) => b.timestamp - a.timestamp);
                const lastThreeCalls = callDetails.slice(0, 3);

                // Format the last three call details into strings
                const formattedCallDetails = lastThreeCalls.map(
                    ({ tokenSymbol, roi }, index) =>
                        `${index + 1}. ${tokenSymbol} \`${roi}%\``
                );

                // Sort roiDetails by ROI in descending order and format into strings
                roiDetails.sort((a, b) => b.roi - a.roi);
                const formattedRoiDetails = roiDetails.map(
                    ({ tokenSymbol, roi }, index) =>
                        `${index + 1}. ${tokenSymbol} \`${roi}%\``
                );

                const formattedGroupDetails = [...groupDetails]
                    .map((channelId) => {
                        const channel = client.channels.cache.get(channelId);
                        return channel
                            ? `• ${channel.name} (${channelId})`
                            : `• Unknown Channel (${channelId})`;
                    })
                    .join("\n");

                // Add user performance summary to embed
                embed.addFields(
                    {
                        name: `**${username}**`,
                        value: `Winrate: \`${winRate}%\` ${getEmojiForWinRate(winRate)} | Avg ROI: \`${averageRoi}%\` ${getEmojiForRoi(averageRoi)}\n` +
                            `Wins: \`${wins}\` | Losses: \`${losses}\` | Total Calls: \`${wins + losses}\``,
                        inline: false,
                    },
                    { name: '**Tokens Called and ROIs**', value: formattedRoiDetails.join("\n") || "None", inline: true },
                    { name: '**Most Recent Calls**', value: formattedCallDetails.join("\n") || "None", inline: true },
                    { name: '**Groups**', value: formattedGroupDetails || "None", inline: true }
                );
            });

            // Send the embed to the alert channel
            alertChannel.send({ embeds: [embed] });
        } else {
            message.channel.send("No users mentioned.");
        }
    }

    const matches = content.match(regex);
    if (matches) {
        matches.forEach(async (ca) => {
            if (!isValidPublicKey(ca)) {
                console.error(`Invalid public key: ${ca}`);
                return;
            }

            // Check if the token address is already tracked by any user
            if (caTracker[ca]) {
                console.log(
                    `Token address ${ca} already tracked by ${caTracker[ca][0].username}. Ignoring further mentions ${caTracker[ca].username}.`
                );
                return;
            }

            // Track the token address if it hasn't been tracked yet
            caTracker[ca] = [
                {
                    timestamp: Date.now(),
                    messageLink: message.url,
                    messageContent: message.content,
                    channelId: message.channel.id,
                    username: message.author.username,
                    userId: message.author.id, // Store the user ID for future use
                    isWin: false, // Initialize isWin to false
                    roi: null,
                    tokenName: null,
                    tokenSymbol: null,
                },
            ];
            await checkAndSendAlert(ca);
        });
    }

    // Other commands follow...
});

client.once("ready", () => {
    console.log("Bot is online!");
    console.log(`Logged in as ${client.user.tag}!`);
    setInterval(checkAllTimeHighs, CHECK_INTERVAL);
});

client.login(BOT_TOKEN);