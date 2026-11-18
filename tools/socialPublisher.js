const { publishPostToFacebook, deletePostFromFacebook } = require("./publishers/facebook");
const { publishPostToFediverse, deletePostFromFediverse } = require("./publishers/fediverse");
const { publishPostToBluesky, deletePostFromBluesky } = require("./publishers/bluesky");
const { publishPostToX, deletePostFromX } = require("./publishers/x");

async function publishToAllSocials(post, req) {
  return Promise.allSettled([
    // publishPostToFacebook(post, req),
    // publishPostToBluesky(post, req),
    // publishPostToX(post, req),
    publishPostToFediverse(post, req),
  ]);
}

async function deleteFromAllSocials(post, req) {
  return Promise.allSettled([
    // deletePostFromFacebook(post, req),
    // deletePostFromBluesky(post, req),
    // deletePostFromX(post, req),
    deletePostFromFediverse(post, req),
  ]);
}

module.exports = { publishToAllSocials, deleteFromAllSocials };
