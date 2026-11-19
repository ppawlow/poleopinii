// tools/socialPublisher.js
const { publishPostToFacebook, deletePostFromFacebook } = require("./publishers/facebook");
const { publishPostToFediverse, deletePostFromFediverse } = require("./publishers/fediverse");
const { publishPostToBluesky, deletePostFromBluesky } = require("./publishers/bluesky");
const { publishPostToX, deletePostFromX } = require("./publishers/x");
const { getSocialShareSettings } = require("./db");

async function publishToAllSocials(post, req) {
  const settings = await getSocialShareSettings();
  const tasks = [];

  if (settings.Facebook) tasks.push(publishPostToFacebook(post, req));
  if (settings.Bluesky) tasks.push(publishPostToBluesky(post, req));
  if (settings.X) tasks.push(publishPostToX(post, req));
  if (settings.Mastodon) tasks.push(publishPostToFediverse(post, req));

  if (tasks.length === 0) return [];
  return Promise.allSettled(tasks);
}

async function deleteFromAllSocials(post, req) {
  return Promise.allSettled([
    deletePostFromFacebook(post, req),
    deletePostFromBluesky(post, req),
    deletePostFromX(post, req),
    deletePostFromFediverse(post, req),
  ]);
}

module.exports = { publishToAllSocials, deleteFromAllSocials };
