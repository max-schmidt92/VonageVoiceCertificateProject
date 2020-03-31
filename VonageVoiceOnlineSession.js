'use strict';

/**
 * Constants - Libraries
 * List of constants showcasing libraries used to handle the file logic
 */
const bodyParser = require('body-parser');
const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);

/**
 * Nexmo constant contains credentials necessary to authenticate to Nexmo services.
 * For more information, please visit the following link: https://github.com/Nexmo/nexmo-node
 */
const Nexmo = require('nexmo');
const nexmo = new Nexmo({
    apiKey: "insert your API key here",
    apiSecret: "insert your API secret here",
    applicationId: "insert your application ID here",
    privateKey: "private.key" // Will be loaded from the same directory as this project
}, {debug: false}); // Leave debug: true to showcase all information.

/**
 * Microsoft credentials and variable defined to speech-to-text functionality
 */
var sdk = require("microsoft-cognitiveservices-speech-sdk");
var speechConfig = sdk.SpeechConfig.fromSubscription("251c726f732043509c478803e65b65dd", "westus");
speechConfig.speechRecognitionLanguage = "en-GB";
var pushStream = sdk.AudioInputStream.createPushStream();
var recognizer = new sdk.SpeechRecognizer(speechConfig,  sdk.AudioConfig.fromStreamInput(pushStream));

/**
 * Teneo constants to handle conversation between Nexmo and Teneo session.
 */

const TIE = require('@artificialsolutions/tie-api-client');

// Language for NCCO object to set the spoken language for interpreting text and reading out text from chatbot
const language_code = "en-GB";

/**
 * Call related variables
 */
const port = 3000;
var CALL_UUID = null;
var endCall = false;
var AUDIO_FILE_NAME = "output.mp3";

/**
 * GET response for Nexmo to retrieve local music file
 */
app.get('/' + AUDIO_FILE_NAME, function(req, res){
    res.sendFile(`${__dirname}/` + AUDIO_FILE_NAME);
});

/**
 * Variables to connect with Teneo session.
 */
// Insert any deployed Teneo URL here
var teneoEngineUrl = 'https://newton-fusion.presales.artificial-solutions.com/engine10/';
// Session ID keeps track of the current conversational session.
var sessionUniqueID = null;
var striptags = require('striptags');
// Placeholder variable to handle the websocket object after it has been initialised
var streamResponse = null;

/**
 * Server configuration
 */
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static('files'));

/**
 * POST response for the default events parameter. No special configuration for this project.
 */
app.post('/webhooks/events', (req, res) => {
    res.sendStatus(200);
});

/**
 * GET response for the default answer parameter. Required to initialise the conversation with caller.
 */
app.get('/webhooks/answer', (req, res) => {

    const introduction_ncco = [
        {
            action: 'talk',
            text: 'Please press 1, 2 or 3.',
            bargeIn: true,
        },
        {
            action: 'input',
            eventUrl: [`${req.protocol}://${req.get('host')}/webhooks/options`]
        }
    ];

    res.status(200).json(introduction_ncco);
});

app.post('/webhooks/options', (req, res) => {

    const option_selected = req.body.dtmf;

    CALL_UUID = req.body.uuid;

    var option_NCCO = null;

    switch(option_selected) {

        // Case 1: Plays a local MP3 Audio file
        case "1":
            const AUDIO_URL = `http://${req.get('host')}/` + AUDIO_FILE_NAME;
            nexmo.calls.stream.start(CALL_UUID, { stream_url: [AUDIO_URL], loop: 1 }, (err, res) => {
                if(err) { console.error(err); }
                else {
                    console.log(res);
                }
            });
            break;

        // Case 2: Reads current date and time.
        case "2":
            var current_date = new Date();
            option_NCCO = [{
                action: 'talk',
                text: 'Current date is ' + current_date.toDateString() + " and time is " + current_date.toTimeString()
            }];
            res.status(200).json(option_NCCO);
            break;

        // Case 3: Transfers from one number to another, after initial message, change to websocket for chatbot help.
        case "3":

            // Define the message sent before connecting to websocket
            var connect_to_websocket_information_promt_NCCO = [
                {
                    action: 'talk',
                    text: 'We are now connecting you to an agent who will be able to help you.'
                }
            ];

            // Have to return this first, it is seemingly not possible to execute the talk and then transfer NCCO
            // into the update call below for some reason? Maybe I am missing some option perhaps :)
            res.status(200).json(connect_to_websocket_information_promt_NCCO);

            // Change the number connected using the information below
            nexmo.calls.update(CALL_UUID, {
                to: [{
                    type: 'phone',
                    number: "46765196067" // Next (second) phone number
                }],
                from: {
                    type: 'phone',
                    number: "46765196073" // First (original) phone number
                },
                action: 'transfer',
                destination: {
                    "type": "ncco",
                    "ncco": [
                        {
                            "action": 'talk',
                            "text": "We are now connecting you to an agent who will be able to help you."
                        },
                        {
                            "action": "connect",
                            "from": "46765196067",
                            "endpoint": [{
                                "type": "websocket",
                                "content-type": "audio/l16;rate=16000",
                                "uri": `ws://${req.hostname}/socket`,
                                // The headers parameter will be past in the config variable below.
                                "headers": {
                                    "language": language_code,
                                    "uuid": CALL_UUID
                                }
                            }],
                        }
                    ]
                }
            }, (err, res) => {
                if (err) {
                    console.error(err);
                }
            });
            break;
        default:
            console.log("error");
            break;
    }
});

/**
 * The following code snippet below showcases Teneo integration.
 * It initialises a websocket communication to perform the following tasks:
 *
 * 1. Parse user input voice to text using Microsoft cognitive services (using free version)
 * 2. Send the parsed text to a Teneo solution (chatbot), wait until a response is given back from the solution.
 * 3. Read out the text to the end-user using the Nexmo TTS functionality.
 *
 * Additional logic can be implemented in the Teneo solution to utilise RPA etc. but for this example,
 * please use the following conversation script:
 *
 * "What can you do?"
 * "I want to book a flight"
 * "<any name of a city as departure city>"
 * "<any name of a city as arrival city>"
 *
 */

/**
 * Websocket communicating with Nexmo and the end-user via the active phone call.
 * CALL_UUID parameter is passed to
 */

app.ws('/socket', (ws, req) => {

    streamResponse = ws;

    // Initialised after answer webhook has started
    ws.on('message', (msg) => {
        // Initiated once as soon as the we
        if (typeof msg === "string") {
            // UUID is captured here.
            let config = JSON.parse(msg);

            if(!CALL_UUID) {
                CALL_UUID = config["uuid"];
            }

            // Introduction message
            processContent(" ");

            // Refresh to keep the session alive
            setInterval(function () {
                ws.send("");
            }, 25000);
        }

        // Send the user input as byte array to Microsoft TTS
        else {
            sendStream(msg);
        }
    });

    // Initiated when caller hangs up.
    ws.on('close', () => {
        // Insert logic to handle final cleanup before closing websocket
    })
});

/**
 *
 * @param msg
 * @returns {Promise<void>}
 */

async function sendStream(msg) {
    await pushStream.write(msg);
}

/**
 * Initialise the server after defining the server functions.
 */

app.listen(port, () => console.log(`Server started using port ${port}`));

recognizer.startContinuousRecognitionAsync();
recognizer.recognized = async function(s, e) {
    if (e.result.text != null && e.result.text.trim() !== "") {
        processContent(e.result.text.toString());
    }
};

/**
 * processContent is an asynchronous function to send input and retrieve output from a Teneo instance.
 * After this is completed, Nexmo TTS is initiated and reads out the text.
 * @param transcript Transcripted text from Microsoft TTS
 */

async function processContent(transcript) {
    await TIE.sendInput(teneoEngineUrl, sessionUniqueID, { text: transcript} )
        .then((response) => {
                console.log("Speech-to-text translation output: " + transcript);
                transcript = striptags(response.output.text);
                console.log("Bot response: " + transcript);
                if (response.output.parameters.endCall==="true") {
                    console.log('set endcall to true');
                    endCall=true;
                }
                return response
            }
        ).then(({sessionId}) => sessionUniqueID = sessionId);
    transcript = transcript.split("||").join("");
    sendTranscriptVoice(transcript);
}

/**
 * sendTranscriptVoice performs Nexmo TTS operation and Nexmo returns the audio back to the end user.
 * @param transcript Message to be sent back to the end user
 */

async function sendTranscriptVoice(transcript) {
    nexmo.calls.talk.start(CALL_UUID, { text: transcript, voice_name: 'Salli', loop: 1, bargeIn: true }, (err, res) => {
        if(err) { console.error(err); }
        else {
            if (endCall) {
                //end the call after speaking the closing message.
                nexmo.calls.update(CALL_UUID,{action:'hangup'},console.log('call ended'))
            }
        }
    });
}
