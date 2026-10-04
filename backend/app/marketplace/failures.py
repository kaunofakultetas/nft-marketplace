############################################################
#  [*] Request failures — told without their URLs
#
#  requests words its errors with the full URL it called, and
#  both outside services the backend calls carry a secret in
#  that URL: Etherscan's query string holds the API key, the
#  RPC provider's path holds the Infura project id. A failure
#  is therefore never passed on as requests worded it — not to
#  the browser, not to the container log. This module turns it
#  into a sentence that says what happened (unreachable, too
#  slow, the HTTP status it answered with, an answer that is
#  not JSON) and nothing of the address.
#
#  Used by:
#    - app/marketplace/etherscan.py — every Etherscan call
#    - app/marketplace/routes.py — the RPC relay
############################################################


import requests









############################################################
# describe_request_failure
############################################################
#
# One sentence for a failed call, `service` its subject. The
# checks run from the most specific kind of failure to the
# most general — a connect timeout is both a timeout and a
# connection error, and is told as the timeout. Anything
# that is no requests failure at all is told by its type
# alone, since nothing is known about what its text holds.
#
# Used by:
#   - etherscan.py — EtherscanClient._get
#   - routes.py — rpc_proxy
############################################################

def describe_request_failure(error, service):
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return f'{service} answered HTTP {error.response.status_code}'
    if isinstance(error, requests.Timeout):
        return f'{service} did not answer in time'
    if isinstance(error, requests.ConnectionError):
        return f'{service} could not be reached'
    if isinstance(error, requests.JSONDecodeError):
        return f'{service} answered something that is not JSON'
    return f'{service} request failed ({type(error).__name__})'
