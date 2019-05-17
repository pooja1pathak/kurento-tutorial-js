/*
* (C) Copyright 2014-2015 Kurento (http://kurento.org/)
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
*/

function getopts(args, opts)
{
  var result = opts.default || {};
  args.replace(
      new RegExp("([^?=&]+)(=([^&]*))?", "g"),
      function($0, $1, $2, $3) { result[$1] = decodeURI($3); });

  return result;
};

var args = getopts(location.search,
{
  default:
  {
    ws_uri: 'ws://' + location.hostname + ':8888/kurento',
    file_uri: 'file:///tmp/kurento-hello-world-recording.webm',
    ice_servers: undefined
  }
});

//var videoInput;
var videoOutput;
var address;
var webRtcPeer;
var client;
var pipeline;

const IDLE = 0;
const DISABLED = 1;
const CALLING = 2;
const PLAYING = 3;

function setStatus(nextState){
  switch(nextState){
    case IDLE:
      $('#start').attr('disabled', false)
      $('#stop').attr('disabled',  true)
      $('#play').attr('disabled',  false)
      break;

    case CALLING:
      $('#start').attr('disabled', true)
      $('#stop').attr('disabled',  false)
      $('#play').attr('disabled',  true)
      break;

    case PLAYING:
      $('#start').attr('disabled', true)
      $('#stop').attr('disabled',  false)
      $('#play').attr('disabled',  true)
      break;

    case DISABLED:
      $('#start').attr('disabled', true)
      $('#stop').attr('disabled',  true)
      $('#play').attr('disabled',  true)
      break;
  }
}

function setIceCandidateCallbacks(webRtcEndpoint, webRtcPeer, onError){
  webRtcPeer.on('icecandidate', function(candidate){
    console.log("Local icecandidate " + JSON.stringify(candidate));

    candidate = kurentoClient.register.complexTypes.IceCandidate(candidate);

    webRtcEndpoint.addIceCandidate(candidate, onError);

  });
  webRtcEndpoint.on('OnIceCandidate', function(event){
    var candidate = event.candidate;

    console.log("Remote icecandidate " + JSON.stringify(candidate));

    webRtcPeer.addIceCandidate(candidate, onError);
  });
}
/*
function setIceCandidateCallbacks(webRtcPeer, webRtcEp, onerror)
{
  webRtcPeer.on('icecandidate', function(candidate) {
    console.log("Local candidate:",candidate);

    candidate = kurentoClient.getComplexType('IceCandidate')(candidate);

    webRtcEp.addIceCandidate(candidate, onerror)
  });

  webRtcEp.on('OnIceCandidate', function(event) {
    var candidate = event.candidate;

    console.log("Remote candidate:",candidate);

    webRtcPeer.addIceCandidate(candidate, onerror);
  });
}
*/

window.onload = function() {
  console = new Console();

  //videoInput = document.getElementById('videoInput');
  videoOutput = document.getElementById('videoOutput');
  address = document.getElementById('address');
  address.value = 'http://files.kurento.org/video/puerta-del-sol.ts';

  setStatus(IDLE);
}

function start() {
  if(!address.value){
   window.alert("You must set the video source URL first");
   return;
  }
  setStatus(DISABLED);
  
  address.disabled = true;
  showSpinner(videoOutput);
  var options = {
    remoteVideo : videoOutput
  };

  //showSpinner(videoInput, videoOutput);

  //var options =
  //{
    //localVideo: videoInput,
    //remoteVideo: videoOutput
  //}

  if (args.ice_servers) {
    console.log("Use ICE servers: " + args.ice_servers);
    options.configuration = {
      iceServers : JSON.parse(args.ice_servers)
    };
  } else {
    console.log("Use freeice")
  }

  webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(error)
  {
    if(error) return onError(error)

    this.generateOffer(onStartOffer)
    
    webRtcPeer.peerConnection.addEventListener('iceconnectionstatechange', function(event){
      if(webRtcPeer && webRtcPeer.peerConnection){
        console.log("oniceconnectionstatechange -> " + webRtcPeer.peerConnection.iceConnectionState);
        console.log('icegatheringstate -> ' + webRtcPeer.peerConnection.iceGatheringState);
      }
    });
  });
}

function stop() {
  address.disabled = false;

  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;
  }

  if(pipeline){
    pipeline.release();
    pipeline = null;
  }

  hideSpinner(videoOutput);
  setStatus(IDLE);
}

function play(){
  setStatus(DISABLED)
  showSpinner(videoOutput);

  var options =
  {
    //localVideo: videoInput,
    remoteVideo: videoOutput
  }

  if (args.ice_servers) {
    console.log("Use ICE servers: " + args.ice_servers);
    options.configuration = {
      iceServers : JSON.parse(args.ice_servers)
    };
  } else {
    console.log("Use freeice")
  }

  webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error)
  {
    if(error) return onError(error)

    this.generateOffer(onPlayOffer)
  });
}

function onPlayOffer(error, sdpOffer){
  if(error) return onError(error);

  co(function*(){
    try{
      if(!client) client = yield kurentoClient(args.ws_uri);

      pipeline = yield client.create('MediaPipeline');

      var webRtc = yield pipeline.create('WebRtcEndpoint');
      //setIceCandidateCallbacks(webRtcPeer, webRtc, onError)
      
      setIceCandidateCallbacks(webRtcEndpoint, webRtcPeer, onError);

      var player = yield pipeline.create('PlayerEndpoint', {uri : args.file_uri});

      player.on('EndOfStream', stop);

      yield player.connect(webRtc);

      var sdpAnswer = yield webRtc.processOffer(sdpOffer);
      webRtc.gatherCandidates(onError);
      webRtcPeer.processAnswer(sdpAnswer);

      yield player.play()

      setStatus(PLAYING)
    }
    catch(e)
    {
      onError(e);
    }
  })();
}

function onStartOffer(error, sdpOffer)
{
  if(error) return onError(error)
  
  co(function*(){
    try{
      if(!client)
        client = yield kurentoClient(args.ws_uri);

      pipeline = yield client.create('MediaPipeline');

      var webRtc = yield pipeline.create('WebRtcEndpoint');
      setIceCandidateCallbacks(webRtcPeer, webRtc, onError)

      var recorder = yield pipeline.create('RecorderEndpoint', {uri: args.file_uri});

      yield webRtc.connect(recorder);
      yield webRtc.connect(webRtc);

      yield recorder.record();

      var sdpAnswer = yield webRtc.processOffer(sdpOffer);
      webRtc.gatherCandidates(onError);
      webRtcPeer.processAnswer(sdpAnswer)

      setStatus(CALLING);

    } catch(e){
      onError(e);
    }
  })();
  
  kurentoClient(args.ws_uri, function(error, kurentoClient) {
    if(error) return onError(error);

  	kurentoClient.create("MediaPipeline", function(error, p) {
  			if(error) return onError(error);

  			pipeline = p;

  			pipeline.create("PlayerEndpoint", {uri: address.value}, function(error, player){
  			  if(error) return onError(error);

  			  pipeline.create("WebRtcEndpoint", function(error, webRtcEndpoint){
  				if(error) return onError(error);
          
          setIceCandidateCallbacks(webRtcEndpoint, webRtcPeer, onError);
            
          var recorder = yield pipeline.create("RecorderEndpoint", {uri: args.file_uri});
          yield webRtc.connect(recorder);
          yield recorder.record();


  				webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer){
  					if(error) return onError(error);

            webRtcEndpoint.gatherCandidates(onError);

  					webRtcPeer.processAnswer(sdpAnswer);
  				});

  				player.connect(webRtcEndpoint, function(error){
  					if(error) return onError(error);

  					console.log("PlayerEndpoint-->WebRtcEndpoint connection established");

  					player.play(function(error){
  					  if(error) return onError(error);

  					  console.log("Player playing ...");
              setStatus(CALLING);
  					});
  				});
  			});
  			});
  		});
  	});
}

function onError(error) {
  if(error)
  {
    console.error(error);
    stop();
  }
}

function showSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].poster = 'img/transparent-1px.png';
    arguments[i].style.background = "center transparent url('img/spinner.gif') no-repeat";
  }
}

function hideSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].src = '';
    arguments[i].poster = 'img/webrtc.png';
    arguments[i].style.background = '';
  }
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
  event.preventDefault();
  $(this).ekkoLightbox();
});
