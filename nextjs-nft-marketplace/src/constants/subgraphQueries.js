import { gql } from "@apollo/client"

export const GET_ACTIVE_ITEM = gql`
    {
        activeItems(first: 5, where: { buyer: "0x0000000000000000000000000000000000000000" }) {
            id
            buyer
            seller
            nftAddress
            tokenId
            price
        }
    }
`

export const GET_ALL_LISTED = gql`
    {
        itemListeds(first: 20, orderBy: tokenId, orderDirection: desc) {
            id
            seller
            nftAddress
            tokenId
            price
        }
    }
`

export const GET_ALL_BOUGHT = gql`
    {
        itemBoughts(first: 20, orderBy: tokenId, orderDirection: desc) {
            id
            buyer
            nftAddress
            tokenId
            price
        }
    }
`

export const GET_ALL_CANCELED = gql`
    {
        itemCanceleds(first: 20, orderBy: tokenId, orderDirection: desc) {
            id
            seller
            nftAddress
            tokenId
        }
    }
`
