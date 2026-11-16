const { publishPostToFacebook, deletePostFromFacebook } = require("./facebookPublisher");
const { publishPostToFediverse, deletePostFromFediverse } = require("./fediversePublisher");

async function publishToAllSocials(post, req) {
  return Promise.allSettled([
    publishPostToFacebook(post, req),
    publishPostToFediverse(post, req),
  ]);
}
async function deleteFromAllSocials(post, req) {
  return Promise.allSettled([
    deletePostFromFacebook(post, req),
    deletePostFromFediverse(post, req),
  ]);
}

module.exports = { publishToAllSocials, deleteFromAllSocials };
