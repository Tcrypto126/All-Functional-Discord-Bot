import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { Metaplex } from "@metaplex-foundation/js";
import { Connection, PublicKey } from "@solana/web3.js";
import { ENV, TokenListProvider } from "@solana/spl-token-registry";
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BOT_IMAGE_URL = process.env.BOT_IMAGE_URL;
const ICON_IMAGE_URL = process.env.ICON_IMAGE_URL;
const ALERT_CHANNEL_ID = '1273682644265074688';
const CA_COUNT = 5
const COUNT_TIME = 10

const EXCLUDED_BOT_ID = [
    '1270155497911095337',
    '1270148826694549505',
    '1270462498562375823',
    '1269735196802940960',
    '1270139028318064691',
    '1270471392571297845',
    '1270475554612838432',
    '1269782311533281281'
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

const caTracker = {};

// Helper function to format market cap
function formatMarketCap(marketCap) {
    if (marketCap >= 1e9) {
        return (marketCap / 1e9).toFixed(2) + ' B';
    } else if (marketCap >= 1e6) {
        return (marketCap / 1e6).toFixed(2) + ' M';
    } else if (marketCap >= 1e3) {
        return (marketCap / 1e3).toFixed(2) + ' K';
    } else if (marketCap > 0) {
        return marketCap.toFixed(2);
    } else {
        return null;
    }
}

async function getTokenPrice(mintAddress) {
    try {
        const response = await fetch(`https://api-v3.raydium.io/mint/price?mints=${mintAddress}`, { timeout: 10000 }); // 10 seconds timeout
        const responseData = await response.json();

        if (responseData.success && responseData.data) {
            const tokenPrice = responseData.data[mintAddress];
            return tokenPrice ? parseFloat(tokenPrice) : null;
        }
    } catch (error) {
        if (error.code === 'UND_ERR_CONNECT_TIMEOUT') {
            console.error('Connection timed out. Please try again later.');
        } else {
            console.error('Error fetching token price:', error);
        }
        return null;
    }

    return null;
}

async function getTokenSupply(connection, mintAddress) {
    const mintInfo = await connection.getParsedAccountInfo(mintAddress);
    if (mintInfo.value && mintInfo.value.data) {
        const supply = mintInfo.value.data.parsed.info.supply;
        return parseFloat(supply) / (10 ** mintInfo.value.data.parsed.info.decimals);
    }

    return null;
}

function formatDate(date) {

    // Extract date components
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = days[date.getUTCDay()];
    const dayOfMonth = date.getUTCDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getUTCMonth()];
    const year = date.getUTCFullYear();

    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12; // Convert 0 to 12 for 12-hour format

    // Format the time as hh:mm
    const formattedTime = `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;

    // Combine everything
    const formattedDate = `${dayOfWeek}, ${dayOfMonth} ${month} ${year} ${formattedTime} UTC`;

    // Format with AM/PM
    return formattedDate;
}

function cleanOldMentions() {
    const tenMinutesAgo = Date.now() - COUNT_TIME * 60 * 1000;
    for (const ca in caTracker) {
        caTracker[ca] = caTracker[ca].filter(entry => entry.timestamp > tenMinutesAgo);
        if (caTracker[ca].length === 0) {
            delete caTracker[ca];
        }
    }
}

// Function to sleep for a specified amount of time (used for delays between retries)
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
        let formattedDate = '❌';
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

            // if (tokenLogo && tokenLogo.startsWith('http')) {
            //     embed.setThumbnail(tokenLogo); // Only set if valid URL
            // }
            tokenDesc = data.description || '❌';
            created_timestamp = data.created_timestamp || '❌';
            raydium_pool = data.raydium_pool || '❌';
            usd_market_cap = data.usd_market_cap || '❌';
            const tokenCreationDate = new Date(data.created_timestamp);
            formattedDate = formatDate(tokenCreationDate);
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
                tokenDesc,
                tokenLogo,
                tokenSymbol,
                tokenX,
                tokenTg,
                tokenWeb,
                // usd_market_cap,
                // created_timestamp,
                raydium_pool,
                isTradingOn,
                exchangeValue,
                formattedDate,
                formattedMarketCap,
            };
            // return data;
        } catch (error) {
            console.error(`Attempt ${attempt} failed: ${error.message}`);

            // If we've reached the maximum number of retries, throw the error
            if (attempt === retries) {
                console.error('Max retries reached. Exiting.');
                throw error;
            }

            // Wait for a delay before retrying (exponential backoff: delay * 2^attempt)
            const backoffDelay = delay * Math.pow(2, attempt);
            console.log(`Retrying in ${backoffDelay / 1000} seconds...`);
            await sleep(backoffDelay);
        }
    }
}

async function getTokenMetadata(ca) {
    console.log("Fetching token metadata...");
    const connection = new Connection("https://va.sharknode.xyz/", 'confirmed');
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
    let formattedDate = '❌';
    let formattedMarketCap = '❌';
    let exchangeValue = '❌'; // Default exchange value

    try {
        const metadataAccount = metaplex.nfts().pdas().metadata({ mint: mintAddress });
        const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);

        if (metadataAccountInfo) {
            const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });

            if (token.json?.createdOn === 'https://pump.fun') {
                isCreatedOnPumpfun = 'Token is created on PumpFun';
                // getPumpFunTokenMetadata(mintAddress).then(metadata => console.log(metadata))
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

                const confirmedSignatures = await connection.getSignaturesForAddress(mintAddress);
                // console.log("confirmedSignatures", confirmedSignatures);
                if (confirmedSignatures.length > 0) {
                    // Filter out any null or undefined blockTime values
                    const validSignatures = confirmedSignatures.filter(sig => sig.blockTime != null);

                    if (validSignatures.length > 0) {
                        // Get the minimum blockTime
                        const minBlockTime = Math.min(...validSignatures.map(sig => sig.blockTime));

                        const tokenCreationDate = new Date(minBlockTime * 1000);

                        // console.log("Lowest blockTime:", minBlockTime);
                        // console.log("tokenCreationDate", tokenCreationDate);

                        if (tokenCreationDate) {
                            formattedDate = formatDate(tokenCreationDate);
                        } else {
                            console.log("Token Creation Date: Not available");
                        }
                    } else {
                        console.log("No valid blockTime found in signatures.");
                    }
                } else {
                    console.log("No signatures found.");
                }

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

                const confirmedSignatures = await connection.getSignaturesForAddress(mintAddress);
                // console.log("confirmedSignatures", confirmedSignatures);

                if (confirmedSignatures.length > 0) {
                    // Filter out any null or undefined blockTime values
                    const validSignatures = confirmedSignatures.filter(sig => sig.blockTime != null);

                    if (validSignatures.length > 0) {
                        // Get the minimum blockTime
                        const minBlockTime = Math.min(...validSignatures.map(sig => sig.blockTime));

                        // console.log("Lowest blockTime:", minBlockTime);

                        const tokenCreationDate = new Date(minBlockTime * 1000);
                        // console.log("tokenCreationDate", tokenCreationDate);

                        if (tokenCreationDate) {
                            formattedDate = formatDate(tokenCreationDate);
                        } else {
                            console.log("Token Creation Date: Not available");
                        }
                    } else {
                        console.log("No valid blockTime found in signatures.");
                    }
                } else {
                    console.log("No signatures found.");
                }

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

    return { tokenName, tokenSymbol, tokenLogo, tokenDesc, tokenX, tokenTg, tokenWeb, isCreatedOnPumpfun, formattedDate, formattedMarketCap, exchangeValue };
}

async function checkAndSendAlert(ca) {
    if (caTracker[ca] && caTracker[ca].length == CA_COUNT) {
        const alertChannel = client.channels.cache.get(ALERT_CHANNEL_ID);

        if (!alertChannel) {
            console.error(`Alert channel with ID ${ALERT_CHANNEL_ID} not found.`);
            return;
        }

        const { tokenName, tokenSymbol, tokenLogo, tokenDesc, tokenX, tokenTg, tokenWeb, formattedDate, formattedMarketCap, exchangeValue } = await getTokenMetadata(ca);

        // Check if any of the critical details are missing
        const isIncomplete = !tokenName && !tokenSymbol;

        const channelMentions = caTracker[ca].reduce((acc, entry) => {
            if (!acc[entry.channelId]) {
                acc[entry.channelId] = { count: 0, messages: [] };
            }
            acc[entry.channelId].count++;
            acc[entry.channelId].messages.push(`[Message tracked at <t:${Math.floor(entry.timestamp / 1000)}:T>](${entry.messageLink})`);
            return acc;
        }, {});

        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(tokenSymbol || 'Unknown Token')
            .setThumbnail(tokenLogo || BOT_IMAGE_URL)
            .addFields(
                { name: 'Token Description', value: tokenDesc || 'No description available', inline: false },
                { name: 'Token Address / CA', value: `\`${ca}\``, inline: false },
                { name: 'MCAP', value: formattedMarketCap || 'NA', inline: true },
                { name: 'EXCHANGE', value: exchangeValue, inline: true },
                { name: 'CREATED', value: formattedDate || '❌', inline: true },
                { name: 'Website', value: tokenWeb !== '❌' ? `[Website](${tokenWeb})` : '❌', inline: true },
                { name: 'Twitter', value: tokenX !== '❌' ? `[Twitter](${tokenX})` : '❌', inline: true },
                { name: 'Telegram', value: tokenTg !== '❌' ? `[Telegram](${tokenTg})` : '❌', inline: true },
                { name: 'Mentions', value: `Total Pings: ${caTracker[ca].length}`, inline: false },
                { name: 'Quick Trade', value: `[BullX](https://bullx.io/terminal?chainId=1399811149&address=${ca}) | [Photon](https://photon-sol.tinyastro.io/en/lp/${ca}?handle=6276553ddaa3fa5705a3a) | [Dexscreener](https://dexscreener.com/search?q=${ca})`, inline: false }
            )
            .setTimestamp()
            .setFooter({iconURL: ICON_IMAGE_URL,  text: 'ConclavioØX' });

        for (const [channelId, details] of Object.entries(channelMentions)) {
            const channel = client.channels.cache.get(channelId);
            const channelName = channel ? channel.name : 'Unknown Channel';
            embed.addFields({
                name: `${channelName} called ${details.count} times`,
                value: details.messages.join('\n'),
                inline: false
            });
        }

        // Send to the appropriate channel based on the completeness of the details
        if (isIncomplete) {
            return;
        } else {
            alertChannel.send({ embeds: [embed] });
        }
    }
}

// client.on('messageCreate', async (message) => {
//     if (message.author.id === client.user.id) return;
//     if (EXCLUDED_BOT_ID.includes(message.author.id)) return;
//     if (!MONITORED_CHANNEL_IDS.includes(message.channel.id)) return;

//     const content = message.content;
//     const regex = /[1-9A-HJ-NP-Za-km-z]{44}/g;

//     const matches = content.match(regex);
//     if (matches) {
//         matches.forEach(ca => {
//             if (!caTracker[ca]) {
//                 caTracker[ca] = [];
//             }
//             caTracker[ca].push({
//                 timestamp: Date.now(),
//                 messageLink: message.url,
//                 messageContent: message.content,
//                 channelId: message.channel.id,
//             });

//             cleanOldMentions();
//             checkAndSendAlert(ca);
//         });
//     }
// });

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    if (EXCLUDED_BOT_ID.includes(message.author.id)) return;
    if (!MONITORED_CHANNEL_IDS.includes(message.channel.id)) return;

    const content = message.content;
    const regex = /[1-9A-HJ-NP-Za-km-z]{44}/g;

    const matches = content.match(regex);
    if (matches) {
        matches.forEach(ca => {
            const now = Date.now();

            if (!caTracker[ca]) {
                caTracker[ca] = [];
            }

            // Filter mentions for the same channel within the COUNT_TIME period
            const existingMentionInChannel = caTracker[ca].find(entry => entry.channelId === message.channel.id && (now - entry.timestamp) < (COUNT_TIME * 60 * 1000));

            if (!existingMentionInChannel) {
                // Only add mention if it's not within the COUNT_TIME in the same channel
                caTracker[ca].push({
                    timestamp: now,
                    messageLink: message.url,
                    messageContent: message.content,
                    channelId: message.channel.id,
                });

                cleanOldMentions();
                checkAndSendAlert(ca);
            }
        });
    }
});

client.once('ready', () => {
    console.log('Bot for 5CA10MINS is ready and monitoring specific channels!');
});

client.login(BOT_TOKEN);
