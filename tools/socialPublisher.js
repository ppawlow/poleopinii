// tools/socialPublisher.js
const { publishPostToFacebook, deletePostFromFacebook } = require("./facebookPublisher");
const { publishPostToFediverse, deletePostFromFediverse } = require("./fediversePublisher");
const { publishPostToBluesky, deletePostFromBluesky } = require("./blueskyPublisher");
const { publishPostToX, deletePostFromX } = require("./xPublisher");

async function publishToAllSocials(post, req) {
  return Promise.allSettled([
    publishPostToFacebook(post, req),
    publishPostToFediverse(post, req),
    publishPostToBluesky(post, req),
    publishPostToX(post, req),
  ]);
}

async function deleteFromAllSocials(post, req) {
  return Promise.allSettled([
    deletePostFromFacebook(post, req),
    deletePostFromFediverse(post, req),
    deletePostFromBluesky(post, req),
    deletePostFromX(post, req),
  ]);
}

module.exports = { publishToAllSocials, deleteFromAllSocials };
