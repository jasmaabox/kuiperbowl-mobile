
import CacheStore from 'react-native-cache-store';

/**
 * Kuiperbowl client
 */
export default class Kuiperbowl {

    constructor(url, updateCallback) {

        this.url = url;
        this.updateCallback = updateCallback;

        this.clientState = {
            player_name: null,
            player_id: null,
            locked_out: null,

            game_state: 'idle',
            current_action: 'idle',

            current_time: null,
            start_time: null,
            end_time: null,
            buzz_start_time: null,
            buzz_passed_time: 0,
            grace_time: 3,
            buzz_time: 8,

            question: null,
            category: null,
            curr_question_content: null,
            scores: null,
            messages: null,

            answer_heading: null,
        };

        this.roomDict = null;
    }

    /**
     * Initialize client
     */
    async init() {

        // Get room lookup table
        this.roomDict = await CacheStore.get("room_dict");
        if (this.roomDict == null) {
            this.roomDict = {};
            CacheStore.set("room_dict", this.roomDict);
        }

        // Get player info for room
        if (this.url in this.roomDict) {
            const playerData = this.roomDict[this.url];
            this.clientState.player_id = playerData['player_id'];
            this.clientState.player_name = playerData['player_name'];
            this.clientState.locked_out = playerData['locked_out'];
        }

        this.createWS();
    }

    /**
     * Cache player data for room
     */
    cacheData() {
        this.roomDict[this.url] = {
            player_id: this.clientState.player_id,
            player_name: this.clientState.player_name,
            locked_out: this.clientState.locked_out,
        }
        CacheStore.set("room_dict", this.roomDict);
    }

    /**
     * Create websocket
     */
    createWS() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.setup();
            this.updateCallback(this.clientState);
        }

        this.ws.onmessage = (e) => {

            const data = JSON.parse(e.data);

            if (data.response_type == "update") {
                // sync client with server
                this.clientState.game_state = data.game_state;
                this.clientState.current_time = data.current_time;
                this.clientState.start_time = data.start_time;
                this.clientState.end_time = data.end_time;
                this.clientState.buzz_start_time = data.buzz_start_time;
                this.clientState.question = data.current_question_content;
                this.clientState.category = data.category;
                this.clientState.scores = data.scores;
                this.clientState.messages = data.messages;
            }
            else if (data.response_type == "new_user") {

                this.clientState.player_id = data.player_id;
                this.clientState.player_name = data.player_name;
                this.clientState.locked_out = false;
                this.cacheData();

                // Update name
                this.ping();
            }
            else if (data.response_type == "send_answer") {
                this.clientState.answer_heading = "Answer: " + data.answer;
            }
            else if (data.response_type == "lock_out") {
                this.clientState.locked_out = true;
                this.cacheData();
            }

            // Update UI
            this.updateCallback(this.clientState);
        }

        this.ws.onclose = () => {

            this.updateCallback(this.clientState);
        }
    }


    /**
     * Set up client
     */
    setup() {
        // set up user
        if (this.clientState.player_id == undefined) {
            this.requestNewUser();
        }
        else {
            this.ping();
            this.join();
        }

        //$('#name').val(player_name);
        //$('#request-content').hide();

        // set up current time if newly joined
        this.clientState.current_time = this.clientState.buzz_start_time;
    }

    /**
     * Update client locally
     */
    update() {
        if (this.clientState.question == undefined) {
            return;
        }

        let time_passed = this.clientState.current_time - this.clientState.start_time;
        let duration = this.clientState.end_time - this.clientState.start_time;

        if (this.clientState.game_state == 'idle') {
            this.clientState.locked_out = false;
            this.cacheData();

            if (this.clientState.answer_heading == null) {
                this.getAnswer();
            }
        }

        else if (this.clientState.game_state == 'playing') {
            this.clientState.buzz_passed_time = 0;
            this.clientState.curr_question_content = this.clientState.question.substring(
                0, 
                Math.round(this.clientState.question.length * (time_passed / (duration - this.clientState.grace_time)))
            )
            this.clientState.current_time += 0.1;
        }

        else if (this.clientState.game_state == 'contest') {
            time_passed = this.clientState.buzz_start_time - this.clientState.start_time;
            this.clientState.curr_question_content = this.clientState.question.substring(
                0,
                Math.round(this.clientState.question.length * (time_passed / (duration - this.clientState.grace_time)))
            )

            // auto answer if over buzz time
            if (this.clientState.buzz_passed_time >= this.clientState.buzz_time) {
                this.answer();
            }
            this.clientState.buzz_passed_time += 0.1;
        }

        // transition to idle if overtime while playing
        if (this.clientState.game_state == 'playing' && this.clientState.current_time >= this.clientState.end_time) {
            this.clientState.game_state = 'idle';
            this.getAnswer();
        }

        // Update UI
        this.updateCallback(this.clientState);

        console.log(this.clientState.game_state);
    }


    /**
     * Ping server
     */
    ping() {
        this.ws.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "ping",
            content: ""
        }));
    }

    /**
     * Join room
     */
    join() {
        this.ws.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "join",
            content: ""
        }));
    }

    /**
     * Leave room
     */
    leave() {
        this.ws.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "leave",
            content: ""
        }));
    }

    /**
     * Request new user
     */
    requestNewUser() {
        this.ws.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "new_user",
            content: ""
        }));
    }

    /**
     * Request name change
     * @param {string} name 
     */
    setName(name) {
        this.ws.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "set_name",
            content: name
        }));
    }

    /**
     * Buzz
     */
    buzz() {

        if (!this.clientState.locked_out && this.clientState.game_state == 'playing') {
            this.clientState.current_action = 'buzz';
            this.clientState.buzz_passed_time = 0;
            this.clientState.game_state = 'contest';

            // this.is_buzz_player = true;
            

            this.ws.send(JSON.stringify({
                player_id: this.clientState.player_id,
                request_type: "buzz_init",
                content: ""
            }));
        }
    }

    /**
     * Open chat input
     */
    openChat() {
        if (this.clientState.current_action != 'buzz') {
            this.clientState.current_action = 'chat';

            /*
            $('#request-content').val('');
            $('#request-content').show();

            $('#next-btn').hide();
            $('#buzz-btn').hide();
            $('#chat-btn').hide();

            setTimeout(function () {
                $('#request-content').focus();
            }, 1);
            */
        }
    }

    /**
     * Send message into chat
     * @param {string} msg 
     */
    sendToChat(msg) {
        if (this.clientState.current_action == 'chat') {

            //$('#next-btn').show();
            //$('#buzz-btn').show();
            //$('#chat-btn').show();
            //$('#request-content').hide();
            this.clientState.current_action = 'idle';

            if (msg == "") {
                return;
            }

            this.ws.send(JSON.stringify({
                player_id: this.clientState.player_id,
                request_type: "chat",
                content: msg
            }));
        }
    }

    /**
     * Answer
     * @param {string} msg 
     */
    answer(msg) {
        if (this.clientState.game_state == 'contest') {

            //$('#next-btn').show();
            //$('#buzz-btn').show();
            //$('#chat-btn').show();
            //$('#request-content').hide();
            this.clientState.game_state = 'playing';
            this.clientState.current_action = 'idle';

            this.ws.send(JSON.stringify({
                player_id: this.clientState.player_id,
                request_type: "buzz_answer",
                content: msg
            }));
        }
    }

    /**
     * Request next question
     */
    next() {
        if (this.clientState.game_state == 'idle') {
            //var question_body = $('#question-space');
            //question_body.html("");

            this.ws.send(JSON.stringify({
                player_id: this.clientState.player_id,
                request_type: "next",
                content: ""
            }));
        }
    }

    /**
     * Request answer
     */
    getAnswer() {
        if (this.clientState.game_state == 'idle') {
            this.ws.send(JSON.stringify({
                request_type: "get_answer",
            }));
        }
    }

    /**
     * Set category
     * @param {string} category 
     */
    setCategory(category) {
        this.ws.send(JSON.stringify({
            request_type: "set_category",
            content: category
        }));
    }

    /**
     * Set difficulty
     * @param {string} difficulty 
     */
    setDifficulty(difficulty) {
        gamesock.send(JSON.stringify({
            request_type: "set_difficulty",
            content: difficulty
        }));
    }

    /**
     * Reset score
     */
    resetScore() {
        gamesock.send(JSON.stringify({
            player_id: this.clientState.player_id,
            request_type: "reset_score",
        }));
    }
}